from __future__ import annotations

import hashlib
import os
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime, timedelta
from importlib import import_module
from typing import Any, Protocol
from urllib.parse import parse_qs, urlsplit

from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,  # noqa: F401 - patched through module facade in tests.
    _qualified_table_sql,
    _table_index_suffix,
)

DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA = "ingestion_projection"
DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE = (
    f"{DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA}.authenticated_notice_attachment_fetch_status"
)
DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY = (
    "AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DATABASE_URL"
)
DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_OPERATOR_DATABASE_URL"
)
DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_MANAGEMENT_DATABASE_URL"
)

FETCH_STATUS_COLLECTED_INTERNAL = "collected_internal"
FETCH_STATUS_TERMINAL_UNAVAILABLE = "terminal_unavailable"
FETCH_STATUS_TRANSIENT_FAILED = "transient_failed"
TERMINAL_REASON_HTTP_404 = "http_404"
TERMINAL_REASON_HTTP_410 = "http_410"
TERMINAL_REASON_PORTAL_FILE_MISSING = "portal_file_missing"

_FETCH_STATUSES = frozenset(
    {
        FETCH_STATUS_COLLECTED_INTERNAL,
        FETCH_STATUS_TERMINAL_UNAVAILABLE,
        FETCH_STATUS_TRANSIENT_FAILED,
    }
)
_TERMINAL_REASONS = frozenset(
    {
        TERMINAL_REASON_HTTP_404,
        TERMINAL_REASON_HTTP_410,
        TERMINAL_REASON_PORTAL_FILE_MISSING,
    }
)


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentFetchStatusRecord:
    site_id: str
    notice_id: str
    attachment_ref_id: str
    source_url: str
    source_url_hash: str
    fetch_status: str
    portal_attachment_id: str | None = None
    filename: str | None = None
    terminal_reason: str | None = None
    last_http_status: int | None = None
    last_error: str | None = None
    attempt_count: int = 0
    first_seen_at: str = field(default_factory=_utc_now)
    last_attempted_at: str | None = None
    next_retry_after: str | None = None
    object_key: str | None = None
    content_sha256: str | None = None
    updated_at: str = field(default_factory=_utc_now)

    def __post_init__(self) -> None:
        normalized = _normalize_status(self.fetch_status)
        object.__setattr__(self, "fetch_status", normalized)
        if self.terminal_reason is not None:
            reason = str(self.terminal_reason).strip()
            if reason not in _TERMINAL_REASONS:
                raise ValueError(f"unsupported terminal_reason: {self.terminal_reason!r}")
            object.__setattr__(self, "terminal_reason", reason)
        if normalized == FETCH_STATUS_TERMINAL_UNAVAILABLE and self.terminal_reason is None:
            raise ValueError("terminal_unavailable records require terminal_reason")
        if self.source_url_hash != build_attachment_source_url_hash(self.source_url):
            raise ValueError("source_url_hash does not match source_url")
        object.__setattr__(self, "attempt_count", max(0, int(self.attempt_count or 0)))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeAttachmentFetchStatusRecord:
        raw = dict(payload)
        raw["attempt_count"] = int(raw.get("attempt_count") or 0)
        if raw.get("last_http_status") is not None:
            raw["last_http_status"] = int(raw["last_http_status"])
        allowed = {item.name for item in fields(cls)}
        return cls(**{key: value for key, value in raw.items() if key in allowed})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class AttachmentFetchStatusCoverageReport:
    source_notice_count: int
    source_attachment_ref_count: int
    fetch_status_record_count: int
    missing_fetch_status_attachment_refs: tuple[str, ...]
    extra_fetch_status_attachment_refs: tuple[str, ...]
    status_counts: dict[str, int]
    terminal_reason_counts: dict[str, int]


class AuthenticatedNoticeAttachmentFetchStatusStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None: ...

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]: ...


class InMemoryAuthenticatedNoticeAttachmentFetchStatusStore:
    def __init__(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord] = (),
    ) -> None:
        self._records: dict[
            tuple[str, str, str], AuthenticatedNoticeAttachmentFetchStatusRecord
        ] = {}
        self.upsert_many(records)

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None:
        for record in records:
            self._records[(record.site_id, record.notice_id, record.attachment_ref_id)] = record

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
        normalized_notice_ids = {str(item).strip() for item in notice_ids if str(item).strip()}
        rows = [
            record
            for key, record in self._records.items()
            if key[0] == site_id and (not normalized_notice_ids or key[1] in normalized_notice_ids)
        ]
        return tuple(sorted(rows, key=lambda item: (item.notice_id, item.attachment_ref_id)))


class PostgresAuthenticatedNoticeAttachmentFetchStatusStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE,
    ) -> None:
        from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url

        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("attachment fetch-status database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
    ) -> None:
        rows = tuple(records)
        if not rows:
            return
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._bulk_upsert_query(), (jsonb_recordset(rows),))

    def list_by_notice_ids(
        self,
        *,
        site_id: str,
        notice_ids: Sequence[str],
    ) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
        normalized_notice_ids = tuple(
            sorted({str(item).strip() for item in notice_ids if str(item).strip()})
        )
        table_sql = _qualified_table_sql(self.table_name)
        query = f"select record from {table_sql} where site_id = %s"
        params: list[object] = [site_id]
        if normalized_notice_ids:
            query += " and notice_id = any(%s)"
            params.append(list(normalized_notice_ids))
        query += " order by notice_id asc, attachment_ref_id asc"
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, tuple(params))
            rows = cursor.fetchall()
        return tuple(
            AuthenticatedNoticeAttachmentFetchStatusRecord.from_dict(_coerce_json_payload(row[0]))
            for row in rows
        )

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _patched_postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    site_id text not null,
                    notice_id text not null,
                    attachment_ref_id text not null,
                    portal_attachment_id text,
                    source_url text not null,
                    source_url_hash text not null,
                    filename text,
                    fetch_status text not null,
                    terminal_reason text,
                    last_http_status integer,
                    last_error text,
                    attempt_count integer not null default 0,
                    first_seen_at timestamptz not null,
                    last_attempted_at timestamptz,
                    next_retry_after timestamptz,
                    object_key text,
                    content_sha256 text,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (site_id, notice_id, attachment_ref_id),
                    check (fetch_status in (
                        'collected_internal',
                        'terminal_unavailable',
                        'transient_failed'
                    )),
                    check (
                        terminal_reason is null or terminal_reason in (
                            'http_404',
                            'http_410',
                            'portal_file_missing'
                        )
                    )
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_terminal
                on {table_sql} (
                    site_id,
                    notice_id,
                    attachment_ref_id,
                    source_url_hash
                )
                where fetch_status = 'terminal_unavailable'
                """
            )

    def _bulk_upsert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            with rows as (
                select
                    item.site_id,
                    item.notice_id,
                    item.attachment_ref_id,
                    item.portal_attachment_id,
                    item.source_url,
                    item.source_url_hash,
                    item.filename,
                    item.fetch_status,
                    item.terminal_reason,
                    item.last_http_status,
                    item.last_error,
                    item.attempt_count,
                    item.first_seen_at,
                    item.last_attempted_at,
                    item.next_retry_after,
                    item.object_key,
                    item.content_sha256,
                    item.updated_at,
                    item.record
                from jsonb_to_recordset(%s::jsonb) as item(
                    site_id text,
                    notice_id text,
                    attachment_ref_id text,
                    portal_attachment_id text,
                    source_url text,
                    source_url_hash text,
                    filename text,
                    fetch_status text,
                    terminal_reason text,
                    last_http_status integer,
                    last_error text,
                    attempt_count integer,
                    first_seen_at timestamptz,
                    last_attempted_at timestamptz,
                    next_retry_after timestamptz,
                    object_key text,
                    content_sha256 text,
                    updated_at timestamptz,
                    record jsonb
                )
            )
            insert into {table_sql} (
                site_id,
                notice_id,
                attachment_ref_id,
                portal_attachment_id,
                source_url,
                source_url_hash,
                filename,
                fetch_status,
                terminal_reason,
                last_http_status,
                last_error,
                attempt_count,
                first_seen_at,
                last_attempted_at,
                next_retry_after,
                object_key,
                content_sha256,
                updated_at,
                record
            )
            select
                site_id,
                notice_id,
                attachment_ref_id,
                portal_attachment_id,
                source_url,
                source_url_hash,
                filename,
                fetch_status,
                terminal_reason,
                last_http_status,
                last_error,
                attempt_count,
                first_seen_at,
                last_attempted_at,
                next_retry_after,
                object_key,
                content_sha256,
                updated_at,
                record
            from rows
            on conflict (site_id, notice_id, attachment_ref_id) do update set
                portal_attachment_id = excluded.portal_attachment_id,
                source_url = excluded.source_url,
                source_url_hash = excluded.source_url_hash,
                filename = excluded.filename,
                fetch_status = excluded.fetch_status,
                terminal_reason = excluded.terminal_reason,
                last_http_status = excluded.last_http_status,
                last_error = excluded.last_error,
                attempt_count = {table_sql}.attempt_count + excluded.attempt_count,
                first_seen_at = least({table_sql}.first_seen_at, excluded.first_seen_at),
                last_attempted_at = excluded.last_attempted_at,
                next_retry_after = excluded.next_retry_after,
                object_key = excluded.object_key,
                content_sha256 = excluded.content_sha256,
                updated_at = excluded.updated_at,
                record = excluded.record
        """


def build_authenticated_notice_attachment_fetch_status_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeAttachmentFetchStatusStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        database_url = (
            source.get(DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not database_url:
            raise ValueError(
                f"{DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeAttachmentFetchStatusStore(
            build_operator_postgres_connection_url(database_url)
        )
    database_url = (
        source.get(DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeAttachmentFetchStatusStore(database_url)


def build_attachment_fetch_status_records_from_bundle_records(
    *,
    bundle_records: Sequence[dict[str, Any]],
    site_id: str,
    observed_at: str | None = None,
) -> tuple[AuthenticatedNoticeAttachmentFetchStatusRecord, ...]:
    rows: list[AuthenticatedNoticeAttachmentFetchStatusRecord] = []
    for bundle_record in bundle_records:
        notice = bundle_record.get("notice")
        if not isinstance(notice, dict):
            continue
        notice_id = str(notice.get("notice_id") or bundle_record.get("notice_id") or "").strip()
        if not notice_id:
            continue
        attachments_by_id = {
            item.get("attachment_id"): item
            for item in _payload_rows(bundle_record.get("attachments"))
            if item.get("attachment_id") is not None
        }
        ref_order = 0
        for relation in _payload_rows(bundle_record.get("notice_attachments")):
            attachment = attachments_by_id.get(relation.get("attachment_id"))
            if attachment is None:
                continue
            ref_order += 1
            record = _build_status_record_for_attachment(
                site_id=site_id,
                notice_id=notice_id,
                attachment_ref_id=f"attachment-{ref_order:04d}",
                attachment=attachment,
                observed_at=observed_at,
            )
            if record is not None:
                rows.append(record)
    return tuple(rows)


def build_attachment_source_url_hash(source_url: str) -> str:
    return hashlib.sha256(str(source_url).strip().encode("utf-8")).hexdigest()


def build_attachment_fetch_status_coverage_report(
    *,
    inventory_entries: Sequence[Any],
    fetch_status_records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> AttachmentFetchStatusCoverageReport:
    expected_refs = set[str]()
    for entry in inventory_entries:
        site_id = str(getattr(entry, "site_id", "") or "").strip()
        notice_id = str(getattr(entry, "notice_id", "") or "").strip()
        attachment_ref_count = int(getattr(entry, "attachment_ref_count", 0) or 0)
        if not site_id or not notice_id:
            continue
        for index in range(1, attachment_ref_count + 1):
            expected_refs.add(_fetch_status_ref_key(site_id, notice_id, f"attachment-{index:04d}"))
    actual_refs = {
        _fetch_status_ref_key(record.site_id, record.notice_id, record.attachment_ref_id)
        for record in fetch_status_records
    }
    status_counts = Counter(record.fetch_status for record in fetch_status_records)
    terminal_reason_counts = Counter(
        record.terminal_reason
        for record in fetch_status_records
        if record.terminal_reason is not None
    )
    return AttachmentFetchStatusCoverageReport(
        source_notice_count=len(tuple(inventory_entries)),
        source_attachment_ref_count=len(expected_refs),
        fetch_status_record_count=len(tuple(fetch_status_records)),
        missing_fetch_status_attachment_refs=tuple(sorted(expected_refs - actual_refs)),
        extra_fetch_status_attachment_refs=tuple(sorted(actual_refs - expected_refs)),
        status_counts=dict(sorted(status_counts.items())),
        terminal_reason_counts=dict(sorted(terminal_reason_counts.items())),
    )


def jsonb_recordset(
    records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> str:
    import json

    return json.dumps(
        [{**record.to_dict(), "record": record.to_dict()} for record in records],
        ensure_ascii=False,
    )


def _build_status_record_for_attachment(
    *,
    site_id: str,
    notice_id: str,
    attachment_ref_id: str,
    attachment: dict[str, Any],
    observed_at: str | None,
) -> AuthenticatedNoticeAttachmentFetchStatusRecord | None:
    source_url = _attachment_source_url(attachment)
    if source_url is None:
        return None
    last_error = _normalize_optional_text(attachment.get("last_error"))
    object_key = _normalize_optional_text(attachment.get("object_key"))
    content_sha256 = _normalize_optional_text(attachment.get("sha256"))
    status, terminal_reason, http_status = _classify_attachment_fetch_status(
        attachment=attachment,
        last_error=last_error,
        object_key=object_key,
        content_sha256=content_sha256,
    )
    timestamp = _normalize_optional_text(attachment.get("updated_at")) or observed_at or _utc_now()
    last_attempted_at = (
        _normalize_optional_text(attachment.get("downloaded_at"))
        or _normalize_optional_text(attachment.get("uploaded_at"))
        or timestamp
    )
    return AuthenticatedNoticeAttachmentFetchStatusRecord(
        site_id=site_id,
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        portal_attachment_id=_portal_attachment_id(source_url),
        source_url=source_url,
        source_url_hash=build_attachment_source_url_hash(source_url),
        filename=_normalize_optional_text(attachment.get("original_filename")),
        fetch_status=status,
        terminal_reason=terminal_reason,
        last_http_status=http_status,
        last_error=last_error,
        attempt_count=1,
        first_seen_at=_normalize_optional_text(attachment.get("created_at")) or timestamp,
        last_attempted_at=last_attempted_at,
        next_retry_after=(
            _retry_after(timestamp) if status == FETCH_STATUS_TRANSIENT_FAILED else None
        ),
        object_key=object_key,
        content_sha256=content_sha256,
        updated_at=timestamp,
    )


def _classify_attachment_fetch_status(
    *,
    attachment: dict[str, Any],
    last_error: str | None,
    object_key: str | None,
    content_sha256: str | None,
) -> tuple[str, str | None, int | None]:
    storage_provider = _normalize_optional_text(attachment.get("storage_provider"))
    ingest_status = _normalize_optional_text(attachment.get("ingest_status"))
    if (
        object_key is not None
        and content_sha256 is not None
        and storage_provider != "reference_only"
        and ingest_status in {"downloaded", "uploaded"}
    ):
        return FETCH_STATUS_COLLECTED_INTERNAL, None, None
    if last_error is not None:
        if _error_mentions_status(last_error, 404):
            return FETCH_STATUS_TERMINAL_UNAVAILABLE, TERMINAL_REASON_HTTP_404, 404
        if _error_mentions_status(last_error, 410):
            return FETCH_STATUS_TERMINAL_UNAVAILABLE, TERMINAL_REASON_HTTP_410, 410
    return FETCH_STATUS_TRANSIENT_FAILED, None, None


def _payload_rows(value: object) -> tuple[dict[str, Any], ...]:
    return tuple(item for item in value or () if isinstance(item, dict))


def _attachment_source_url(attachment: dict[str, Any]) -> str | None:
    for key in ("final_url", "normalized_source_url", "source_url"):
        candidate = _normalize_optional_text(attachment.get(key))
        if candidate is not None:
            return candidate
    return None


def _portal_attachment_id(source_url: str) -> str | None:
    try:
        query = parse_qs(urlsplit(source_url).query)
    except ValueError:
        return None
    values = query.get("id")
    if not values:
        return None
    return _normalize_optional_text(values[0])


def _error_mentions_status(message: str, status: int) -> bool:
    return (
        f" {status}" in message or f":{status}" in message or message.strip().endswith(str(status))
    )


def _retry_after(timestamp: str) -> str:
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.now(UTC)
    return (parsed.astimezone(UTC) + timedelta(hours=6)).isoformat()


def _normalize_status(value: str) -> str:
    normalized = str(value).strip()
    if normalized not in _FETCH_STATUSES:
        raise ValueError(f"unsupported fetch_status: {value!r}")
    return normalized


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _fetch_status_ref_key(site_id: str, notice_id: str, attachment_ref_id: str) -> str:
    return f"{site_id}:{notice_id}:{attachment_ref_id}"


def _inventory_facade():
    return import_module("campus_ingestion_core.authenticated_notice_attachment_fetch_status")


def _patched_postgres_connection(*args, **kwargs):
    return _inventory_facade()._postgres_connection(*args, **kwargs)


__all__ = [
    "DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE",
    "FETCH_STATUS_COLLECTED_INTERNAL",
    "FETCH_STATUS_TERMINAL_UNAVAILABLE",
    "FETCH_STATUS_TRANSIENT_FAILED",
    "TERMINAL_REASON_HTTP_404",
    "TERMINAL_REASON_HTTP_410",
    "TERMINAL_REASON_PORTAL_FILE_MISSING",
    "AuthenticatedNoticeAttachmentFetchStatusRecord",
    "AuthenticatedNoticeAttachmentFetchStatusStore",
    "AttachmentFetchStatusCoverageReport",
    "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
    "PostgresAuthenticatedNoticeAttachmentFetchStatusStore",
    "build_attachment_fetch_status_records_from_bundle_records",
    "build_attachment_fetch_status_coverage_report",
    "build_attachment_source_url_hash",
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
]
