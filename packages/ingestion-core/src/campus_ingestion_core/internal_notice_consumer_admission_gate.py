from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    validate_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    normalize_notice_ids,
)

CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD = "projection_rebuild"
CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD = "read_model_rebuild"
CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION = "typed_materialization"
CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN = "multimodal_drain"
CONSUMER_ADMISSION_GATE_OPERATION_IMPORT_MATERIALIZATION = "import_materialization"

CONSUMER_ADMISSION_GATE_VERDICT_ALLOW = "allow"
CONSUMER_ADMISSION_GATE_VERDICT_BLOCK = "block"

CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST = "missing_manifest"
CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST = "invalid_manifest"
CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH = "scope_mismatch"
CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH = "id_mismatch"
CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED = "replace_scope_not_authorized"
CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION = "target_surface_violation"
CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH = "threshold_breach"


@dataclass(frozen=True, slots=True)
class ConsumerAdmissionGateRequest:
    operation: str
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...] = ()
    scope_write_mode: str = "upsert_selected"
    target_surface: str = ""
    max_empty_body_count: int | None = None
    max_owner_expectation_count: int | None = None
    max_reference_only_attachment_count: int | None = None
    max_unsupported_binary_count: int | None = None
    max_pending_multimodal_attachment_count: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "operation", str(self.operation or "").strip())
        object.__setattr__(self, "source_corpus", str(self.source_corpus or "").strip())
        object.__setattr__(
            self,
            "source_collection",
            str(self.source_collection or "").strip(),
        )
        object.__setattr__(
            self,
            "selected_notice_ids",
            normalize_notice_ids(self.selected_notice_ids),
        )
        object.__setattr__(
            self,
            "scope_write_mode",
            str(self.scope_write_mode or "").strip(),
        )
        object.__setattr__(self, "target_surface", str(self.target_surface or "").strip())


@dataclass(frozen=True, slots=True)
class ConsumerAdmissionGateReport:
    verdict: str
    reason_codes: tuple[str, ...]
    operation: str
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    manifest_selected_notice_ids: tuple[str, ...] = ()
    target_surface_counts: dict[str, int] = field(default_factory=dict)
    consumption_status_counts: dict[str, int] = field(default_factory=dict)
    admission_decision_counts: dict[str, int] = field(default_factory=dict)
    threshold_counts: dict[str, int] = field(default_factory=dict)

    @property
    def allowed(self) -> bool:
        return self.verdict == CONSUMER_ADMISSION_GATE_VERDICT_ALLOW


def check_internal_notice_consumer_admission_gate(
    *,
    manifest: InternalNoticeConsumerAdmissionManifest | None,
    request: ConsumerAdmissionGateRequest,
) -> ConsumerAdmissionGateReport:
    reasons: list[str] = []
    if manifest is None:
        return _report(
            request=request,
            manifest=None,
            reasons=(CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST,),
        )
    try:
        validate_internal_notice_consumer_admission_manifest(manifest)
    except ValueError:
        return _report(
            request=request,
            manifest=manifest,
            reasons=(CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST,),
        )
    if manifest.corpus != request.source_corpus or manifest.collection != request.source_collection:
        reasons.append(CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH)
    if request.scope_write_mode == CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE and (
        manifest.scope_write_mode != CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE
    ):
        reasons.append(CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED)
    requested_notice_ids = request.selected_notice_ids or manifest.selected_notice_ids
    if set(requested_notice_ids) - set(manifest.selected_notice_ids):
        reasons.append(CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH)
    records = _selected_records(manifest, requested_notice_ids)
    if not _operation_target_surfaces_are_allowed(request, records):
        reasons.append(CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION)
    if _thresholds_breached(request, records):
        reasons.append(CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH)
    return _report(request=request, manifest=manifest, reasons=tuple(reasons))


def admitted_notice_ids_for_target_surface(
    manifest: InternalNoticeConsumerAdmissionManifest,
    *,
    target_surface: str,
    consumption_status: str | None = None,
) -> tuple[str, ...]:
    validate_internal_notice_consumer_admission_manifest(manifest)
    return tuple(
        sorted(
            record.notice_id
            for record in manifest.decision_records
            if record.admission_decision == CONSUMER_ADMISSION_DECISION_ADMIT
            and record.target_surface == target_surface
            and (consumption_status is None or record.consumption_status == consumption_status)
        )
    )


def _operation_target_surfaces_are_allowed(
    request: ConsumerAdmissionGateRequest,
    records: Sequence[ConsumerAdmissionDecisionRecord],
) -> bool:
    if request.operation == CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD:
        return all(
            record.target_surface == NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
            and record.consumption_status == NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY
            for record in records
        )
    if request.operation == CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION:
        return bool(request.target_surface) and all(
            record.target_surface == request.target_surface for record in records
        )
    if request.operation == CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN:
        return all(
            record.target_surface == NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE
            and record.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
            for record in records
        )
    return True


def _thresholds_breached(
    request: ConsumerAdmissionGateRequest,
    records: Sequence[ConsumerAdmissionDecisionRecord],
) -> bool:
    threshold_pairs = (
        (
            request.max_empty_body_count,
            sum(1 for record in records if record.body_quality == "empty_body"),
        ),
        (
            request.max_owner_expectation_count,
            sum(record.owner_expectation_count for record in records),
        ),
        (
            request.max_reference_only_attachment_count,
            sum(record.reference_only_attachment_ref_count for record in records),
        ),
        (
            request.max_unsupported_binary_count,
            sum(record.unsupported_binary_count for record in records),
        ),
        (
            request.max_pending_multimodal_attachment_count,
            sum(record.pending_multimodal_attachment_count for record in records),
        ),
    )
    return any(limit is not None and observed > limit for limit, observed in threshold_pairs)


def _selected_records(
    manifest: InternalNoticeConsumerAdmissionManifest,
    selected_notice_ids: Sequence[str],
) -> tuple[ConsumerAdmissionDecisionRecord, ...]:
    selected = set(normalize_notice_ids(selected_notice_ids))
    return tuple(
        record
        for record in manifest.decision_records
        if not selected or record.notice_id in selected
    )


def _report(
    *,
    request: ConsumerAdmissionGateRequest,
    manifest: InternalNoticeConsumerAdmissionManifest | None,
    reasons: Sequence[str],
) -> ConsumerAdmissionGateReport:
    records = manifest.decision_records if manifest is not None else ()
    selected_records = _selected_records(manifest, request.selected_notice_ids) if manifest else ()
    reason_codes = tuple(dict.fromkeys(item for item in reasons if item))
    return ConsumerAdmissionGateReport(
        verdict=(
            CONSUMER_ADMISSION_GATE_VERDICT_BLOCK
            if reason_codes
            else CONSUMER_ADMISSION_GATE_VERDICT_ALLOW
        ),
        reason_codes=reason_codes,
        operation=request.operation,
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        selected_notice_ids=request.selected_notice_ids,
        manifest_selected_notice_ids=(manifest.selected_notice_ids if manifest else ()),
        target_surface_counts=dict(
            sorted(Counter(record.target_surface for record in records).items())
        ),
        consumption_status_counts=dict(
            sorted(Counter(record.consumption_status for record in records).items())
        ),
        admission_decision_counts=dict(
            sorted(Counter(record.admission_decision for record in records).items())
        ),
        threshold_counts={
            "empty_body_count": sum(
                1 for record in selected_records if record.body_quality == "empty_body"
            ),
            "owner_expectation_count": sum(
                record.owner_expectation_count for record in selected_records
            ),
            "reference_only_attachment_ref_count": sum(
                record.reference_only_attachment_ref_count for record in selected_records
            ),
            "unsupported_binary_count": sum(
                record.unsupported_binary_count for record in selected_records
            ),
            "pending_multimodal_attachment_count": sum(
                record.pending_multimodal_attachment_count for record in selected_records
            ),
        },
    )


__all__ = [
    "CONSUMER_ADMISSION_GATE_OPERATION_IMPORT_MATERIALIZATION",
    "CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN",
    "CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD",
    "CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD",
    "CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION",
    "CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH",
    "CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST",
    "CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST",
    "CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED",
    "CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH",
    "CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION",
    "CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH",
    "CONSUMER_ADMISSION_GATE_VERDICT_ALLOW",
    "CONSUMER_ADMISSION_GATE_VERDICT_BLOCK",
    "ConsumerAdmissionGateReport",
    "ConsumerAdmissionGateRequest",
    "admitted_notice_ids_for_target_surface",
    "check_internal_notice_consumer_admission_gate",
]
