from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
    DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
    AuthenticatedNoticeFileReleaseInventoryStore,
)
from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    FileReleaseOwnerRecoveryReadinessReport,
    resolve_file_release_owner_recovery_readiness_from_inventory_store,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    InternalNoticeSelectedRegulationCohortAuditReport,
    InternalNoticeSelectedRegulationCohortAuditRow,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import DocumentRegistry
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED

INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_SCHEMA_VERSION = (
    "internal_notice_regulation_owner_recovery_v1"
)
INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_LOOKUP_ORDER = (
    "captured_attachment",
    "authenticated_file_release",
    "official_web_source",
    "existing_regulation_registry",
)
DEFAULT_OFFICIAL_WEB_OWNER_SCOPES = (
    ("official_web", "stable_reference"),
    ("official_web", "muc_public_pages"),
)
DEFAULT_EXISTING_REGULATION_OWNER_SCOPES = (
    ("regulations", "institutional_rules"),
    ("regulations", "scoped_rules"),
    ("regulations", "student_rules"),
)

_FILE_EXTENSION_RE = re.compile(
    r"\.(pdf|doc|docx|wps|txt|rtf|html?|md)$",
    re.IGNORECASE,
)
_MATCH_NORMALIZE_RE = re.compile(r"[\s《》“”\"'‘’()（）【】\[\]：:、，,。.;；·\-—_<>/]+")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")
_ATTACHMENT_ID_RE = re.compile(
    r"^notice_attachment:(?P<site_id>[^:]+):(?P<notice_id>[^:]+):"
    r"(?P<attachment_ref_id>[^:]+)"
)


class OwnerRecoveryObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationOwnerRecoveryAttempt:
    source_kind: str
    status: str
    reason: str | None
    source_document_id: str | None = None
    source_corpus: str | None = None
    source_collection: str | None = None
    source_uri: str | None = None
    evidence: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationOwnerRecoveryRow:
    notice_id: str
    title: str
    source_url: str | None
    owner_title_hint: str
    classification: str
    stable_reason: str
    status: str
    reason: str | None
    selected_source_kind: str | None
    selected_source_document_id: str | None
    selected_source_corpus: str | None
    selected_source_collection: str | None
    selected_source_uri: str | None
    source_backed_candidate: bool
    import_eligible: bool
    notice_card_preserved: bool
    attempts: tuple[InternalNoticeRegulationOwnerRecoveryAttempt, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationOwnerRecoveryReport:
    schema_version: str
    source_corpus: str
    source_collection: str
    lookup_order: tuple[str, ...]
    requested_notice_ids: tuple[str, ...]
    row_count: int
    ready_candidate_count: int
    unresolved_count: int
    ready_candidate_notice_ids: tuple[str, ...]
    unresolved_notice_ids: tuple[str, ...]
    rows: tuple[InternalNoticeRegulationOwnerRecoveryRow, ...]


def build_internal_notice_regulation_owner_recovery_report(
    *,
    audit_report: InternalNoticeSelectedRegulationCohortAuditReport,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore,
    registry: DocumentRegistry,
    object_store: OwnerRecoveryObjectStore | None = None,
    bucket_derived: str = DEFAULT_BUCKET_DERIVED,
    file_release_inventory_store: AuthenticatedNoticeFileReleaseInventoryStore | None = None,
    file_release_corpus: str = DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
    file_release_collection: str = DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
    official_web_scopes: Sequence[tuple[str, str]] = DEFAULT_OFFICIAL_WEB_OWNER_SCOPES,
    existing_regulation_scopes: Sequence[tuple[str, str]] = (
        DEFAULT_EXISTING_REGULATION_OWNER_SCOPES
    ),
) -> InternalNoticeRegulationOwnerRecoveryReport:
    recovery_audit_rows = tuple(row for row in audit_report.rows if _is_owner_recovery_row(row))
    inventory_entries = source_truth_inventory_store.list_by_scope(
        audit_report.source_corpus,
        audit_report.source_collection,
        notice_ids=tuple(row.notice_id for row in recovery_audit_rows),
    )
    inventory_by_notice_id = {entry.notice_id: entry for entry in inventory_entries}
    rows = tuple(
        _build_recovery_row(
            audit_row=row,
            inventory_entry=inventory_by_notice_id.get(row.notice_id),
            registry=registry,
            object_store=object_store,
            bucket_derived=bucket_derived,
            file_release_inventory_store=file_release_inventory_store,
            file_release_corpus=file_release_corpus,
            file_release_collection=file_release_collection,
            official_web_scopes=tuple(official_web_scopes),
            existing_regulation_scopes=tuple(existing_regulation_scopes),
        )
        for row in recovery_audit_rows
    )
    ready_notice_ids = tuple(row.notice_id for row in rows if row.status == "ready")
    unresolved_notice_ids = tuple(row.notice_id for row in rows if row.status == "unresolved")
    return InternalNoticeRegulationOwnerRecoveryReport(
        schema_version=INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_SCHEMA_VERSION,
        source_corpus=audit_report.source_corpus,
        source_collection=audit_report.source_collection,
        lookup_order=INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_LOOKUP_ORDER,
        requested_notice_ids=audit_report.requested_notice_ids,
        row_count=len(rows),
        ready_candidate_count=len(ready_notice_ids),
        unresolved_count=len(unresolved_notice_ids),
        ready_candidate_notice_ids=ready_notice_ids,
        unresolved_notice_ids=unresolved_notice_ids,
        rows=rows,
    )


def export_internal_notice_regulation_owner_recovery_report(
    *,
    output_dir: Path,
    report: InternalNoticeRegulationOwnerRecoveryReport,
) -> tuple[Path, Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "owner-recovery-report.json"
    rows_path = output_dir / "owner-recovery-rows.jsonl"
    payload = asdict(report)
    rows = payload.pop("rows")
    payload["row_count"] = len(rows)
    report_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    with rows_path.open("w", encoding="utf-8") as handle:
        for row in report.rows:
            handle.write(json.dumps(asdict(row), ensure_ascii=False, sort_keys=True))
            handle.write("\n")
    return report_path, rows_path


def _build_recovery_row(
    *,
    audit_row: InternalNoticeSelectedRegulationCohortAuditRow,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    registry: DocumentRegistry,
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
    file_release_inventory_store: AuthenticatedNoticeFileReleaseInventoryStore | None,
    file_release_corpus: str,
    file_release_collection: str,
    official_web_scopes: tuple[tuple[str, str], ...],
    existing_regulation_scopes: tuple[tuple[str, str], ...],
) -> InternalNoticeRegulationOwnerRecoveryRow:
    owner_title_hint = _resolve_owner_title_hint(audit_row, inventory_entry)
    attempts: list[InternalNoticeRegulationOwnerRecoveryAttempt] = []
    for source_kind in INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_LOOKUP_ORDER:
        if source_kind == "captured_attachment":
            attempt = _attempt_captured_attachment(
                audit_row=audit_row,
                inventory_entry=inventory_entry,
                owner_title_hint=owner_title_hint,
                registry=registry,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
        elif source_kind == "authenticated_file_release":
            attempt = _attempt_file_release(
                owner_title_hint=owner_title_hint,
                file_release_inventory_store=file_release_inventory_store,
                file_release_corpus=file_release_corpus,
                file_release_collection=file_release_collection,
            )
        elif source_kind == "official_web_source":
            attempt = _attempt_registry_scopes(
                source_kind=source_kind,
                owner_title_hint=owner_title_hint,
                reason_if_missing="official_web_source_not_found",
                registry=registry,
                scopes=official_web_scopes,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
        else:
            attempt = _attempt_registry_scopes(
                source_kind=source_kind,
                owner_title_hint=owner_title_hint,
                reason_if_missing="existing_regulation_registry_not_found",
                registry=registry,
                scopes=existing_regulation_scopes,
                object_store=object_store,
                bucket_derived=bucket_derived,
            )
        attempts.append(attempt)
        if attempt.status == "ready":
            return _ready_row(
                audit_row=audit_row,
                owner_title_hint=owner_title_hint,
                selected=attempt,
                attempts=tuple(attempts),
            )
    return InternalNoticeRegulationOwnerRecoveryRow(
        notice_id=audit_row.notice_id,
        title=audit_row.title,
        source_url=audit_row.source_url,
        owner_title_hint=owner_title_hint,
        classification=audit_row.classification,
        stable_reason=audit_row.stable_reason,
        status="unresolved",
        reason="owner_recovery_source_not_found",
        selected_source_kind=None,
        selected_source_document_id=None,
        selected_source_corpus=None,
        selected_source_collection=None,
        selected_source_uri=None,
        source_backed_candidate=False,
        import_eligible=False,
        notice_card_preserved=True,
        attempts=tuple(attempts),
    )


def _ready_row(
    *,
    audit_row: InternalNoticeSelectedRegulationCohortAuditRow,
    owner_title_hint: str,
    selected: InternalNoticeRegulationOwnerRecoveryAttempt,
    attempts: tuple[InternalNoticeRegulationOwnerRecoveryAttempt, ...],
) -> InternalNoticeRegulationOwnerRecoveryRow:
    return InternalNoticeRegulationOwnerRecoveryRow(
        notice_id=audit_row.notice_id,
        title=audit_row.title,
        source_url=audit_row.source_url,
        owner_title_hint=owner_title_hint,
        classification=audit_row.classification,
        stable_reason=audit_row.stable_reason,
        status="ready",
        reason=None,
        selected_source_kind=selected.source_kind,
        selected_source_document_id=selected.source_document_id,
        selected_source_corpus=selected.source_corpus,
        selected_source_collection=selected.source_collection,
        selected_source_uri=selected.source_uri,
        source_backed_candidate=True,
        import_eligible=True,
        notice_card_preserved=True,
        attempts=attempts,
    )


def _attempt_captured_attachment(
    *,
    audit_row: InternalNoticeSelectedRegulationCohortAuditRow,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    owner_title_hint: str,
    registry: DocumentRegistry,
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
) -> InternalNoticeRegulationOwnerRecoveryAttempt:
    expectations = _owner_expectations(inventory_entry)
    attachment_ref_ids = tuple(
        dict.fromkeys(
            value
            for expectation in expectations
            if _optional_text(expectation.get("owner_kind")) == "attachment_document"
            for value in (
                _optional_text(expectation.get("attachment_ref_id")),
                _optional_text(expectation.get("source_attachment_ref_id")),
            )
            if value is not None
        )
    )
    records = tuple(
        record
        for record in registry.list_by_scope("campus_notices", "internal_notice")
        if _is_notice_attachment_record(record, audit_row.notice_id)
    )
    if attachment_ref_ids:
        records = tuple(
            record
            for record in records
            if _attachment_ref_id_from_document_id(record.document_id) in attachment_ref_ids
        )
    if not records:
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind="captured_attachment",
            status="not_found",
            reason="captured_attachment_not_found",
            evidence={"attachment_ref_ids": attachment_ref_ids},
        )
    selected = _best_record_match(
        records=records,
        owner_title_hint=owner_title_hint,
        object_store=object_store,
        bucket_derived=bucket_derived,
    )
    if selected is None:
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind="captured_attachment",
            status="not_found",
            reason="captured_attachment_title_not_matched",
            evidence={"attachment_ref_ids": attachment_ref_ids},
        )
    if not _record_has_recoverable_text_source(
        selected.record,
        object_store=object_store,
        bucket_derived=bucket_derived,
    ):
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind="captured_attachment",
            status="blocked",
            reason="captured_attachment_canonical_text_missing",
            source_document_id=selected.record.document_id,
            source_corpus=selected.record.corpus,
            source_collection=selected.record.collection,
            source_uri=selected.record.source_uri,
            evidence=_record_evidence(selected),
        )
    return InternalNoticeRegulationOwnerRecoveryAttempt(
        source_kind="captured_attachment",
        status="ready",
        reason=None,
        source_document_id=selected.record.document_id,
        source_corpus=selected.record.corpus,
        source_collection=selected.record.collection,
        source_uri=selected.record.source_uri,
        evidence=_record_evidence(selected),
    )


def _attempt_file_release(
    *,
    owner_title_hint: str,
    file_release_inventory_store: AuthenticatedNoticeFileReleaseInventoryStore | None,
    file_release_corpus: str,
    file_release_collection: str,
) -> InternalNoticeRegulationOwnerRecoveryAttempt:
    if file_release_inventory_store is None:
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind="authenticated_file_release",
            status="not_found",
            reason="file_release_inventory_unavailable",
        )
    readiness = resolve_file_release_owner_recovery_readiness_from_inventory_store(
        owner_title_hint=owner_title_hint,
        inventory_store=file_release_inventory_store,
        corpus=file_release_corpus,
        collection=file_release_collection,
    )
    if readiness.status != "ready" or readiness.selected_match is None:
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind="authenticated_file_release",
            status="not_found" if readiness.status == "missing_capture" else "blocked",
            reason=readiness.reason,
            evidence=_file_release_readiness_evidence(readiness),
        )
    selected = readiness.selected_match
    released_file = selected.released_file
    source_uri = (
        released_file.final_url
        or released_file.source_url
        or selected.resolved_download_url
        or readiness.export_scope
    )
    return InternalNoticeRegulationOwnerRecoveryAttempt(
        source_kind="authenticated_file_release",
        status="ready",
        reason=None,
        source_document_id=f"file_release:{readiness.site_id or 'unknown'}:{selected.file_release_id}",
        source_corpus=file_release_corpus,
        source_collection=file_release_collection,
        source_uri=source_uri,
        evidence=_file_release_readiness_evidence(readiness),
    )


def _attempt_registry_scopes(
    *,
    source_kind: str,
    owner_title_hint: str,
    reason_if_missing: str,
    registry: DocumentRegistry,
    scopes: tuple[tuple[str, str], ...],
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
) -> InternalNoticeRegulationOwnerRecoveryAttempt:
    records: list[DocumentRegistryRecord] = []
    for corpus, collection in scopes:
        records.extend(
            record
            for record in registry.list_by_scope(corpus, collection)
            if record.status == "active" and record.is_current
        )
    selected = _best_record_match(
        records=tuple(records),
        owner_title_hint=owner_title_hint,
        object_store=object_store,
        bucket_derived=bucket_derived,
    )
    if selected is None:
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind=source_kind,
            status="not_found",
            reason=reason_if_missing,
            evidence={"scopes": [f"{corpus}/{collection}" for corpus, collection in scopes]},
        )
    if not _record_has_recoverable_text_source(
        selected.record,
        object_store=object_store,
        bucket_derived=bucket_derived,
    ):
        return InternalNoticeRegulationOwnerRecoveryAttempt(
            source_kind=source_kind,
            status="blocked",
            reason=f"{source_kind}_canonical_text_missing",
            source_document_id=selected.record.document_id,
            source_corpus=selected.record.corpus,
            source_collection=selected.record.collection,
            source_uri=selected.record.source_uri,
            evidence=_record_evidence(selected),
        )
    return InternalNoticeRegulationOwnerRecoveryAttempt(
        source_kind=source_kind,
        status="ready",
        reason=None,
        source_document_id=selected.record.document_id,
        source_corpus=selected.record.corpus,
        source_collection=selected.record.collection,
        source_uri=selected.record.source_uri,
        evidence=_record_evidence(selected),
    )


@dataclass(frozen=True, slots=True)
class _RecordMatch:
    record: DocumentRegistryRecord
    match_score: int
    match_strategy: str
    matched_title: str


def _best_record_match(
    *,
    records: tuple[DocumentRegistryRecord, ...],
    owner_title_hint: str,
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
) -> _RecordMatch | None:
    normalized_hint = _normalize_title_for_match(owner_title_hint)
    if not normalized_hint:
        return None
    matches: list[_RecordMatch] = []
    for record in records:
        best: _RecordMatch | None = None
        for title in _record_title_candidates(
            record,
            object_store=object_store,
            bucket_derived=bucket_derived,
        ):
            normalized_title = _normalize_title_for_match(title)
            if not normalized_title:
                continue
            score, strategy = _score_title_match(
                owner_title_hint=normalized_hint,
                candidate_title=normalized_title,
            )
            if score < 0 or strategy is None:
                continue
            candidate = _RecordMatch(
                record=record,
                match_score=score,
                match_strategy=strategy,
                matched_title=title,
            )
            if best is None or candidate.match_score > best.match_score:
                best = candidate
        if best is not None:
            matches.append(best)
    if not matches:
        return records[0] if len(records) == 1 else None
    return max(matches, key=lambda item: (item.match_score, item.record.ingestion_timestamp))


def _record_has_recoverable_text_source(
    record: DocumentRegistryRecord,
    *,
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
) -> bool:
    if not (record.canonical_markdown_object_key or record.document_units_object_key):
        return False
    if object_store is None or not record.canonical_markdown_object_key:
        return True
    try:
        body = object_store.get_bytes(
            bucket=bucket_derived,
            key=record.canonical_markdown_object_key,
        ).decode("utf-8")
    except Exception:
        return False
    return bool(body.strip())


def _record_title_candidates(
    record: DocumentRegistryRecord,
    *,
    object_store: OwnerRecoveryObjectStore | None,
    bucket_derived: str,
) -> tuple[str, ...]:
    values = [record.document_id, record.source_uri]
    if object_store is not None and record.canonical_markdown_object_key:
        try:
            body = object_store.get_bytes(
                bucket=bucket_derived,
                key=record.canonical_markdown_object_key,
            ).decode("utf-8")
            title = _first_markdown_heading(body)
            if title:
                values.insert(0, title)
        except Exception:
            pass
    return tuple(dict.fromkeys(value for value in values if value.strip()))


def _record_evidence(match: _RecordMatch) -> dict[str, object]:
    record = match.record
    return {
        "match_score": match.match_score,
        "match_strategy": match.match_strategy,
        "matched_title": match.matched_title,
        "canonical_markdown_object_key": record.canonical_markdown_object_key,
        "document_units_object_key": record.document_units_object_key,
    }


def _file_release_readiness_evidence(
    readiness: FileReleaseOwnerRecoveryReadinessReport,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "status": readiness.status,
        "reason": readiness.reason,
        "match_count": readiness.match_count,
        "ambiguous_file_release_ids": readiness.ambiguous_file_release_ids,
    }
    if readiness.selected_match is not None:
        selected = readiness.selected_match
        payload.update(
            {
                "file_release_id": selected.file_release_id,
                "match_score": selected.match_score,
                "match_strategy": selected.match_strategy,
                "filename": selected.filename,
                "bucket": selected.released_file.bucket,
                "object_key": selected.released_file.object_key,
                "sha256": selected.released_file.sha256,
            }
        )
    return payload


def _is_owner_recovery_row(row: InternalNoticeSelectedRegulationCohortAuditRow) -> bool:
    return row.target_recommendation == "owner_recovery" or row.classification in {
        "attachment_owner_candidate",
        "file_release_owner_candidate",
        "official_web_owner_candidate",
        "missing_owner",
    }


def _owner_expectations(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> tuple[dict[str, object], ...]:
    if entry is None:
        return ()
    return tuple(
        dict(item)
        for item in (dict(entry.parent_snapshot or {}).get("owner_expectations") or ())
        if isinstance(item, Mapping)
    )


def _resolve_owner_title_hint(
    row: InternalNoticeSelectedRegulationCohortAuditRow,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> str:
    for expectation in _owner_expectations(inventory_entry):
        value = _optional_text(expectation.get("owner_title_hint"))
        if value is not None:
            return value
    quote_match = _QUOTE_TITLE_RE.search(row.title)
    if quote_match is not None:
        return quote_match.group(1).strip()
    return row.title.strip()


def _is_notice_attachment_record(record: DocumentRegistryRecord, notice_id: str) -> bool:
    match = _ATTACHMENT_ID_RE.match(record.document_id)
    return match is not None and match.group("notice_id") == notice_id


def _attachment_ref_id_from_document_id(document_id: str) -> str | None:
    match = _ATTACHMENT_ID_RE.match(document_id)
    if match is None:
        return None
    return match.group("attachment_ref_id")


def _first_markdown_heading(body: str) -> str | None:
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("#").strip() or None
    return None


def _normalize_title_for_match(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized:
        return ""
    normalized = _FILE_EXTENSION_RE.sub("", normalized).strip()
    normalized = _MATCH_NORMALIZE_RE.sub("", normalized)
    return normalized.strip().lower()


def _score_title_match(*, owner_title_hint: str, candidate_title: str) -> tuple[int, str | None]:
    if owner_title_hint == candidate_title:
        return (200, "exact_normalized_title")
    if owner_title_hint in candidate_title:
        return (100, "owner_hint_contained_in_candidate")
    if candidate_title in owner_title_hint:
        return (90, "candidate_contained_in_owner_hint")
    return (-1, None)


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


__all__ = [
    "INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_LOOKUP_ORDER",
    "INTERNAL_NOTICE_REGULATION_OWNER_RECOVERY_SCHEMA_VERSION",
    "InternalNoticeRegulationOwnerRecoveryAttempt",
    "InternalNoticeRegulationOwnerRecoveryReport",
    "InternalNoticeRegulationOwnerRecoveryRow",
    "build_internal_notice_regulation_owner_recovery_report",
    "export_internal_notice_regulation_owner_recovery_report",
]
