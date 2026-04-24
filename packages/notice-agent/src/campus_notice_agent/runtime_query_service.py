from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

from campus_notice_agent.read_model_query_service import (
    NoticeReadModelQueryService,
    NoticeReadModelRecord,
    ObjectStoreNoticeBodyRepository,
)

DEFAULT_INTERNAL_NOTICE_READ_MODEL_DATABASE_ENV_KEY = "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"
DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE = "ingestion_projection.internal_notice_read_model"
SHARED_POSTGRES_ENV_KEY = "CAMPUS_SHARED_POSTGRES_URL"

DEFAULT_OBJECT_STORE_BUCKET_DERIVED = "campus-rag-derived"

_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class _Connection(Protocol):
    def __enter__(self) -> Any: ...

    def __exit__(self, exc_type, exc, tb) -> bool: ...


ConnectionFactory = Callable[..., _Connection]


class PostgresNoticeReadModelRepository:
    def __init__(
        self,
        *,
        database_url: str,
        table_name: str = DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE,
        connection_factory: ConnectionFactory | None = None,
    ) -> None:
        self.database_url = _normalize_postgres_url(database_url)
        if not self.database_url:
            raise ValueError("internal notice read model database url is required")
        self.table_name = table_name
        self._table_sql = _qualified_table_sql(table_name)
        self._connection_factory = connection_factory or _postgres_connection

    def search(
        self,
        *,
        source_families: Sequence[str],
        query_text: str,
        max_results: int,
    ) -> tuple[NoticeReadModelRecord, ...]:
        allowed_source_families = [
            str(item).strip() for item in source_families if str(item).strip()
        ]
        normalized_query = query_text.strip()
        params: list[object] = [allowed_source_families]
        filters = ["queryable = true", "source_family = any(%s)"]
        if normalized_query:
            params.extend(
                (
                    normalized_query,
                    f"%{normalized_query}%",
                    f"%{normalized_query}%",
                )
            )
            filters.append(
                "("
                "search_vector @@ plainto_tsquery('simple', %s) "
                "or title ilike %s "
                "or search_text ilike %s"
                ")"
            )
        params.append(max_results)
        query = (
            f"select record from {self._table_sql} "
            f"where {' and '.join(filters)} "
            "order by published_at desc nulls last, source_notice_id desc, unit_id asc "
            "limit %s"
        )
        return self._fetch_records(query, tuple(params))

    def get_by_notice_id(
        self,
        *,
        notice_id: str,
        source_family: str = "",
    ) -> NoticeReadModelRecord | None:
        filters = ["queryable = true", "source_notice_id = %s"]
        params: list[object] = [notice_id]
        if source_family.strip():
            filters.append("source_family = %s")
            params.append(source_family.strip())
        query = (
            f"select record from {self._table_sql} "
            f"where {' and '.join(filters)} "
            "order by published_at desc nulls last, unit_id asc limit 1"
        )
        rows = self._fetch_records(query, tuple(params))
        return rows[0] if rows else None

    def _fetch_records(
        self,
        query: str,
        params: tuple[object, ...],
    ) -> tuple[NoticeReadModelRecord, ...]:
        with self._connection_factory(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            rows = cursor.fetchall()
        return tuple(_record_from_payload(row[0]) for row in rows)


@dataclass(frozen=True, slots=True)
class NoticeObjectStoreSettings:
    endpoint: str
    access_key: str
    secret_key: str
    region: str = "us-east-1"
    bucket_derived: str = DEFAULT_OBJECT_STORE_BUCKET_DERIVED

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> NoticeObjectStoreSettings | None:
        endpoint = (env.get("OBJECT_STORE_ENDPOINT") or "").strip()
        access_key = (
            env.get("OBJECT_STORE_DERIVED_ACCESS_KEY") or env.get("OBJECT_STORE_ACCESS_KEY") or ""
        ).strip()
        secret_key = (
            env.get("OBJECT_STORE_DERIVED_SECRET_KEY") or env.get("OBJECT_STORE_SECRET_KEY") or ""
        ).strip()
        if not endpoint or not access_key or not secret_key:
            return None
        parsed = urlparse(endpoint)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return None
        return cls(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=(env.get("OBJECT_STORE_REGION") or "us-east-1").strip() or "us-east-1",
            bucket_derived=(
                env.get("OBJECT_STORE_BUCKET_DERIVED") or DEFAULT_OBJECT_STORE_BUCKET_DERIVED
            ).strip()
            or DEFAULT_OBJECT_STORE_BUCKET_DERIVED,
        )


class S3NoticeBodyObjectStore:
    def __init__(self, settings: NoticeObjectStoreSettings) -> None:
        import boto3

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.endpoint,
            aws_access_key_id=settings.access_key,
            aws_secret_access_key=settings.secret_key,
            region_name=settings.region,
        )

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            response = self._client.get_object(Bucket=bucket, Key=key)
        except Exception as exc:
            raise LookupError(f"notice body object is unavailable: {key}") from exc
        return response["Body"].read()


def build_notice_read_model_query_service_from_env(
    env: Mapping[str, str] | None = None,
) -> NoticeReadModelQueryService | None:
    source = env if env is not None else os.environ
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_DATABASE_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or ""
    ).strip()
    object_store_settings = NoticeObjectStoreSettings.from_env(source)
    if not database_url or object_store_settings is None:
        return None
    return NoticeReadModelQueryService(
        read_repository=PostgresNoticeReadModelRepository(database_url=database_url),
        body_repository=ObjectStoreNoticeBodyRepository(
            object_store=S3NoticeBodyObjectStore(object_store_settings),
            bucket=object_store_settings.bucket_derived,
        ),
    )


def _postgres_connection(database_url: str) -> _Connection:
    import psycopg

    return psycopg.connect(database_url)


def _normalize_postgres_url(database_url: str) -> str:
    normalized = database_url.strip()
    if normalized.startswith("postgres://"):
        return "postgresql://" + normalized.removeprefix("postgres://")
    return normalized


def _record_from_payload(payload: object) -> NoticeReadModelRecord:
    raw = _coerce_payload_dict(payload)
    return NoticeReadModelRecord(
        source_family=str(raw.get("source_family") or ""),
        source_notice_id=str(raw.get("source_notice_id") or ""),
        title=str(raw.get("title") or ""),
        source_url=str(raw.get("source_url") or ""),
        canonical_url=str(raw.get("canonical_url") or ""),
        published_at=str(raw.get("published_at") or ""),
        effective_at=str(raw.get("effective_at") or ""),
        target_surface=str(raw.get("target_surface") or ""),
        primary_role=str(raw.get("primary_role") or ""),
        canonical_markdown_object_key=str(raw.get("canonical_markdown_object_key") or ""),
        attachment_refs=_coerce_text_tuple(raw.get("attachment_refs")),
        provenance_refs=_coerce_text_tuple(raw.get("provenance_refs")),
    )


def _coerce_payload_dict(payload: object) -> dict[str, object]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        parsed = json.loads(payload)
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("notice read model record payload must be a JSON object")


def _coerce_text_tuple(payload: object) -> tuple[str, ...]:
    if payload is None:
        return ()
    if isinstance(payload, str):
        values = (payload,)
    else:
        values = tuple(payload) if isinstance(payload, Sequence) else ()
    return tuple(str(value).strip() for value in values if str(value).strip())


def _qualified_table_sql(table_name: str) -> str:
    parts = tuple(part.strip() for part in table_name.split(".") if part.strip())
    if not parts or len(parts) > 2:
        raise ValueError("notice read model table name must be table or schema.table")
    for part in parts:
        if not _IDENTIFIER_RE.fullmatch(part):
            raise ValueError(f"invalid notice read model table identifier: {part}")
    return ".".join(f'"{part}"' for part in parts)


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_DATABASE_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE",
    "DEFAULT_OBJECT_STORE_BUCKET_DERIVED",
    "SHARED_POSTGRES_ENV_KEY",
    "NoticeObjectStoreSettings",
    "PostgresNoticeReadModelRepository",
    "S3NoticeBodyObjectStore",
    "build_notice_read_model_query_service_from_env",
]
