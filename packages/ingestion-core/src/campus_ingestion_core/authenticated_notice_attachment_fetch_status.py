from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY as DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY as DEFAULT_ATTACHMENT_FETCH_STATUS_MANAGEMENT_ENV_KEY,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY as DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA as DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE as DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_models import (
    FETCH_STATUS_COLLECTED_INTERNAL,
    FETCH_STATUS_TERMINAL_UNAVAILABLE,
    FETCH_STATUS_TRANSIENT_FAILED,
    TERMINAL_REASON_HTTP_404,
    TERMINAL_REASON_HTTP_410,
    TERMINAL_REASON_PORTAL_FILE_MISSING,
    AttachmentFetchStatusCoverageReport,
    AttachmentOwnerExpectationMismatchRow,
    AuthenticatedNoticeAttachmentFetchStatusRecord,
    AuthenticatedNoticeControlPlaneStatusReport,
    AuthenticatedNoticeLiveHistoricalReconcileReport,
    ReferenceOnlyAttachmentExplanationReport,
    ReferenceOnlyAttachmentExplanationRow,
    _utc_now,
    build_attachment_source_url_hash,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_store import (
    AuthenticatedNoticeAttachmentFetchStatusStore,
    InMemoryAuthenticatedNoticeAttachmentFetchStatusStore,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_store import (
    PostgresAuthenticatedNoticeAttachmentFetchStatusStore as PostgresAuthenticatedNoticeAttachmentFetchStatusStore,
)
from campus_ingestion_core.authenticated_notice_attachment_fetch_status_store import (
    build_authenticated_notice_attachment_fetch_status_store_from_env as build_authenticated_notice_attachment_fetch_status_store_from_env,
)
from campus_ingestion_core.registry import (
    _postgres_connection,  # noqa: F401 - patched through module facade in tests.
)


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


def build_reference_only_attachment_explanation_report(
    *,
    inventory_entries: Sequence[Any],
    attachment_refs_by_key: dict[str, Sequence[dict[str, Any]]],
    fetch_status_records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> ReferenceOnlyAttachmentExplanationReport:
    entries = tuple(inventory_entries)
    fetch_status_by_ref = {
        _fetch_status_ref_key(record.site_id, record.notice_id, record.attachment_ref_id): record
        for record in fetch_status_records
    }
    rows: list[ReferenceOnlyAttachmentExplanationRow] = []
    for entry in entries:
        if int(getattr(entry, "reference_only_count", 0) or 0) <= 0:
            continue
        site_id = str(getattr(entry, "site_id", "") or "").strip()
        notice_id = str(getattr(entry, "notice_id", "") or "").strip()
        if not site_id or not notice_id:
            continue
        attachment_refs_key = str(getattr(entry, "attachment_refs_key", "") or "").strip()
        attachment_refs = tuple(attachment_refs_by_key.get(attachment_refs_key, ()))
        projected_attachment_ref_ids = _projected_attachment_ref_ids(entry)
        non_reference_terminal_attachment_ref_ids = _non_reference_terminal_attachment_ref_ids(
            entry
        )
        if not attachment_refs:
            rows.extend(
                _missing_attachment_ref_artifact_rows(
                    entry=entry,
                    site_id=site_id,
                    notice_id=notice_id,
                    projected_attachment_ref_ids=projected_attachment_ref_ids,
                    non_reference_terminal_attachment_ref_ids=(
                        non_reference_terminal_attachment_ref_ids
                    ),
                    fetch_status_by_ref=fetch_status_by_ref,
                )
            )
            continue
        for attachment_ref in attachment_refs:
            attachment_ref_id = _normalize_optional_text(attachment_ref.get("attachment_ref_id"))
            if (
                attachment_ref_id is None
                or attachment_ref_id in projected_attachment_ref_ids
                or attachment_ref_id in non_reference_terminal_attachment_ref_ids
            ):
                continue
            rows.append(
                _explain_reference_only_attachment_ref(
                    site_id=site_id,
                    notice_id=notice_id,
                    attachment_ref_id=attachment_ref_id,
                    attachment_ref=attachment_ref,
                    fetch_status=fetch_status_by_ref.get(
                        _fetch_status_ref_key(site_id, notice_id, attachment_ref_id)
                    ),
                )
            )
    reason_counts = Counter(row.reason for row in rows)
    return ReferenceOnlyAttachmentExplanationReport(
        source_notice_count=len(entries),
        source_attachment_ref_count=sum(
            int(getattr(entry, "attachment_ref_count", 0) or 0) for entry in entries
        ),
        reference_only_inventory_count=sum(
            int(getattr(entry, "reference_only_count", 0) or 0) for entry in entries
        ),
        reference_only_attachment_count=len(rows),
        action_required_count=sum(1 for row in rows if row.action_required),
        reason_counts=dict(sorted(reason_counts.items())),
        rows=tuple(
            sorted(
                rows,
                key=lambda item: (item.notice_id, item.attachment_ref_id, item.reason),
            )
        ),
    )


def build_authenticated_notice_live_historical_reconcile_report(
    *,
    inventory_entries: Sequence[Any],
    fetch_status_records: Sequence[AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> AuthenticatedNoticeLiveHistoricalReconcileReport:
    coverage_report = build_attachment_fetch_status_coverage_report(
        inventory_entries=inventory_entries,
        fetch_status_records=fetch_status_records,
    )
    owner_mismatches = _attachment_owner_expectation_mismatches(inventory_entries)
    action_required_count = (
        len(coverage_report.missing_fetch_status_attachment_refs)
        + len(owner_mismatches)
        + int(coverage_report.status_counts.get(FETCH_STATUS_TRANSIENT_FAILED, 0) or 0)
    )
    return AuthenticatedNoticeLiveHistoricalReconcileReport(
        source_notice_count=coverage_report.source_notice_count,
        source_attachment_ref_count=coverage_report.source_attachment_ref_count,
        fetch_status_record_count=coverage_report.fetch_status_record_count,
        missing_fetch_status_attachment_refs=coverage_report.missing_fetch_status_attachment_refs,
        extra_fetch_status_attachment_refs=coverage_report.extra_fetch_status_attachment_refs,
        status_counts=coverage_report.status_counts,
        terminal_reason_counts=coverage_report.terminal_reason_counts,
        attachment_owner_expectation_mismatch_count=len(owner_mismatches),
        attachment_owner_expectation_mismatches=owner_mismatches,
        action_required_count=action_required_count,
    )


def build_authenticated_notice_control_plane_status_report(
    *,
    inventory_entries: Sequence[Any],
    reconcile_report: AuthenticatedNoticeLiveHistoricalReconcileReport,
    reference_only_report: ReferenceOnlyAttachmentExplanationReport,
    latest_collector_run: dict[str, Any] | None = None,
) -> AuthenticatedNoticeControlPlaneStatusReport:
    entries = tuple(inventory_entries)
    notice_risk_counts = Counter(
        str(getattr(entry, "notice_risk_label", "") or "body_only") for entry in entries
    )
    unsupported_binary_count = sum(
        int(getattr(entry, "unsupported_binary_count", 0) or 0) for entry in entries
    )
    multimodal_processing_required_count = sum(
        int(getattr(entry, "multimodal_processing_required_count", 0) or 0) for entry in entries
    )
    action_required_count = (
        reconcile_report.action_required_count + reference_only_report.action_required_count
    )
    return AuthenticatedNoticeControlPlaneStatusReport(
        source_notice_count=len(entries),
        source_attachment_ref_count=sum(
            int(getattr(entry, "attachment_ref_count", 0) or 0) for entry in entries
        ),
        fetch_status_record_count=reconcile_report.fetch_status_record_count,
        missing_fetch_status_attachment_ref_count=len(
            reconcile_report.missing_fetch_status_attachment_refs
        ),
        extra_fetch_status_attachment_ref_count=len(
            reconcile_report.extra_fetch_status_attachment_refs
        ),
        reference_only_attachment_count=reference_only_report.reference_only_attachment_count,
        reference_only_action_required_count=reference_only_report.action_required_count,
        reconcile_action_required_count=reconcile_report.action_required_count,
        unsupported_binary_count=unsupported_binary_count,
        multimodal_processing_required_count=multimodal_processing_required_count,
        notice_risk_counts=dict(sorted(notice_risk_counts.items())),
        action_required_count=action_required_count,
        latest_collector_run=dict(latest_collector_run)
        if latest_collector_run is not None
        else None,
        reconcile_report=reconcile_report,
        reference_only_report=reference_only_report,
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


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _fetch_status_ref_key(site_id: str, notice_id: str, attachment_ref_id: str) -> str:
    return f"{site_id}:{notice_id}:{attachment_ref_id}"


def _projected_attachment_ref_ids(entry: Any) -> set[str]:
    parent_snapshot = getattr(entry, "parent_snapshot", None)
    if not isinstance(parent_snapshot, dict):
        return set()
    rows = parent_snapshot.get("attachment_projection_plans") or ()
    projected: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        attachment_ref_id = _normalize_optional_text(row.get("attachment_ref_id"))
        if attachment_ref_id is not None:
            projected.add(attachment_ref_id)
    return projected


def _non_reference_terminal_attachment_ref_ids(entry: Any) -> set[str]:
    parent_snapshot = getattr(entry, "parent_snapshot", None)
    if not isinstance(parent_snapshot, dict):
        return set()
    rows = parent_snapshot.get("terminal_attachment_outcomes") or ()
    terminal: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("classification") or "") == "reference_only":
            continue
        attachment_ref_id = _normalize_optional_text(row.get("attachment_ref_id"))
        if attachment_ref_id is not None:
            terminal.add(attachment_ref_id)
    return terminal


def _attachment_owner_expectation_mismatches(
    inventory_entries: Sequence[Any],
) -> tuple[AttachmentOwnerExpectationMismatchRow, ...]:
    rows: list[AttachmentOwnerExpectationMismatchRow] = []
    for entry in inventory_entries:
        if int(getattr(entry, "attachment_ref_count", 0) or 0) > 0:
            continue
        site_id = str(getattr(entry, "site_id", "") or "").strip()
        notice_id = str(getattr(entry, "notice_id", "") or "").strip()
        parent_snapshot = getattr(entry, "parent_snapshot", None)
        if not site_id or not notice_id or not isinstance(parent_snapshot, dict):
            continue
        for expectation in parent_snapshot.get("owner_expectations") or ():
            if not isinstance(expectation, dict):
                continue
            owner_kind = str(expectation.get("owner_kind") or "").strip()
            relation_type = str(expectation.get("relation_type") or "").strip()
            if owner_kind != "attachment_document" or relation_type != "attachment_ref":
                continue
            rows.append(
                AttachmentOwnerExpectationMismatchRow(
                    site_id=site_id,
                    notice_id=notice_id,
                    owner_kind=owner_kind,
                    relation_type=relation_type,
                    owner_title_hint=_normalize_optional_text(expectation.get("owner_title_hint")),
                    evidence_text=_normalize_optional_text(expectation.get("evidence_text")),
                )
            )
    return tuple(
        sorted(
            rows,
            key=lambda item: (
                item.notice_id,
                item.owner_title_hint or "",
                item.evidence_text or "",
            ),
        )
    )


def _missing_attachment_ref_artifact_rows(
    *,
    entry: Any,
    site_id: str,
    notice_id: str,
    projected_attachment_ref_ids: set[str],
    non_reference_terminal_attachment_ref_ids: set[str],
    fetch_status_by_ref: dict[str, AuthenticatedNoticeAttachmentFetchStatusRecord],
) -> tuple[ReferenceOnlyAttachmentExplanationRow, ...]:
    attachment_ref_count = int(getattr(entry, "attachment_ref_count", 0) or 0)
    rows: list[ReferenceOnlyAttachmentExplanationRow] = []
    for index in range(1, attachment_ref_count + 1):
        attachment_ref_id = f"attachment-{index:04d}"
        if (
            attachment_ref_id in projected_attachment_ref_ids
            or attachment_ref_id in non_reference_terminal_attachment_ref_ids
        ):
            continue
        fetch_status = fetch_status_by_ref.get(
            _fetch_status_ref_key(site_id, notice_id, attachment_ref_id)
        )
        rows.append(
            _explain_reference_only_attachment_ref(
                site_id=site_id,
                notice_id=notice_id,
                attachment_ref_id=attachment_ref_id,
                attachment_ref={},
                fetch_status=fetch_status,
                missing_artifact=True,
            )
        )
    return tuple(rows)


def _explain_reference_only_attachment_ref(
    *,
    site_id: str,
    notice_id: str,
    attachment_ref_id: str,
    attachment_ref: dict[str, Any],
    fetch_status: AuthenticatedNoticeAttachmentFetchStatusRecord | None,
    missing_artifact: bool = False,
) -> ReferenceOnlyAttachmentExplanationRow:
    reason, action_required = _reference_only_explanation_reason(
        attachment_ref=attachment_ref,
        fetch_status=fetch_status,
        missing_artifact=missing_artifact,
    )
    return ReferenceOnlyAttachmentExplanationRow(
        site_id=site_id,
        notice_id=notice_id,
        attachment_ref_id=attachment_ref_id,
        reason=reason,
        action_required=action_required,
        resource_role=_normalize_optional_text(attachment_ref.get("resource_role")),
        content_kind=_normalize_optional_text(attachment_ref.get("content_kind")),
        mime_type=_normalize_optional_text(attachment_ref.get("mime_type")),
        object_key=_normalize_optional_text(attachment_ref.get("object_key")),
        content_sha256=_normalize_optional_text(attachment_ref.get("content_sha256")),
        source_url=_normalize_optional_text(attachment_ref.get("source_url")),
        final_url=_normalize_optional_text(attachment_ref.get("final_url")),
        fetch_status=fetch_status.fetch_status if fetch_status is not None else None,
        terminal_reason=fetch_status.terminal_reason if fetch_status is not None else None,
    )


def _reference_only_explanation_reason(
    *,
    attachment_ref: dict[str, Any],
    fetch_status: AuthenticatedNoticeAttachmentFetchStatusRecord | None,
    missing_artifact: bool,
) -> tuple[str, bool]:
    if fetch_status is not None:
        if fetch_status.fetch_status == FETCH_STATUS_TERMINAL_UNAVAILABLE:
            return "terminal_unavailable", False
        if fetch_status.fetch_status == FETCH_STATUS_TRANSIENT_FAILED:
            return "transient_fetch_failed", True
    if missing_artifact:
        return "missing_attachment_refs_artifact", True
    object_key = _normalize_optional_text(attachment_ref.get("object_key"))
    content_sha256 = _normalize_optional_text(attachment_ref.get("content_sha256"))
    resource_role = _normalize_optional_text(attachment_ref.get("resource_role"))
    if object_key is not None and content_sha256 is not None:
        if resource_role == "inline_image":
            return "object_backed_inline_image_reference_only", False
        return "object_backed_non_document_reference_only", False
    if object_key is not None:
        return "object_backed_missing_checksum", True
    return "missing_object_key", True


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
    "AttachmentFetchStatusCoverageReport",
    "AuthenticatedNoticeAttachmentFetchStatusRecord",
    "AuthenticatedNoticeAttachmentFetchStatusStore",
    "InMemoryAuthenticatedNoticeAttachmentFetchStatusStore",
    "PostgresAuthenticatedNoticeAttachmentFetchStatusStore",
    "ReferenceOnlyAttachmentExplanationReport",
    "ReferenceOnlyAttachmentExplanationRow",
    "build_attachment_fetch_status_coverage_report",
    "build_attachment_fetch_status_records_from_bundle_records",
    "build_attachment_source_url_hash",
    "build_authenticated_notice_attachment_fetch_status_store_from_env",
    "build_reference_only_attachment_explanation_report",
]
