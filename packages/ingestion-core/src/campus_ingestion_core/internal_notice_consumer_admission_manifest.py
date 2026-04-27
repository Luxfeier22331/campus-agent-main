from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    normalize_notice_ids,
)

CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION = "internal_notice_consumer_admission_manifest.v1"
CONSUMER_ADMISSION_POLICY_VERSION = "internal_notice_consumer_admission_policy.v1"

CONSUMER_ADMISSION_DECISION_ADMIT = "admit"
CONSUMER_ADMISSION_DECISION_BLOCK = "block"
CONSUMER_ADMISSION_DECISION_NO_ADOPTION = "no_adoption"

CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION = (
    "candidate_for_typed_materialization"
)

CONSUMER_ADMISSION_BODY_QUALITY_PRESENT = "body_present"
CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY = "title_only"
CONSUMER_ADMISSION_BODY_QUALITY_EMPTY = "empty_body"

CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED = "upsert_selected"
CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE = "replace_scope"

ALLOWED_CONSUMER_ADMISSION_TARGET_SURFACES = frozenset(
    {
        NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
        NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
        NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
        NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        NOTICE_TARGET_SURFACE_UNSUPPORTED,
    }
)
ALLOWED_CONSUMER_ADMISSION_STATUSES = frozenset(
    {
        NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
    }
)
ALLOWED_CONSUMER_ADMISSION_DECISIONS = frozenset(
    {
        CONSUMER_ADMISSION_DECISION_ADMIT,
        CONSUMER_ADMISSION_DECISION_BLOCK,
        CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
    }
)
ALLOWED_CONSUMER_ADMISSION_SCOPE_WRITE_MODES = frozenset(
    {
        CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
        CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
    }
)


@dataclass(frozen=True, slots=True)
class ConsumerAdmissionDecisionRecord:
    notice_id: str
    source_notice_id: str
    site_id: str
    raw_asset_id: str
    raw_version_id: str
    notice_family: str
    suggested_consumption_route: str
    target_surface: str
    consumption_status: str
    admission_decision: str
    admission_reason_codes: tuple[str, ...]
    body_quality: str
    attachment_ref_count: int
    reference_only_attachment_ref_count: int
    owner_expectation_count: int
    pending_multimodal_attachment_count: int
    attachment_document_count: int = 0
    unsupported_binary_count: int = 0

    def __post_init__(self) -> None:
        object.__setattr__(self, "notice_id", str(self.notice_id or "").strip())
        object.__setattr__(
            self,
            "source_notice_id",
            str(self.source_notice_id or self.notice_id or "").strip(),
        )
        object.__setattr__(self, "site_id", str(self.site_id or "").strip())
        object.__setattr__(self, "raw_asset_id", str(self.raw_asset_id or "").strip())
        object.__setattr__(self, "raw_version_id", str(self.raw_version_id or "").strip())
        object.__setattr__(self, "notice_family", str(self.notice_family or "").strip())
        object.__setattr__(
            self,
            "suggested_consumption_route",
            str(self.suggested_consumption_route or "").strip(),
        )
        object.__setattr__(self, "target_surface", str(self.target_surface or "").strip())
        object.__setattr__(
            self,
            "consumption_status",
            str(self.consumption_status or "").strip(),
        )
        object.__setattr__(
            self,
            "admission_decision",
            str(self.admission_decision or "").strip(),
        )
        object.__setattr__(
            self,
            "admission_reason_codes",
            tuple(
                dict.fromkeys(
                    str(item).strip() for item in self.admission_reason_codes if str(item).strip()
                )
            ),
        )
        object.__setattr__(self, "body_quality", str(self.body_quality or "").strip())
        for field_name in (
            "attachment_ref_count",
            "reference_only_attachment_ref_count",
            "owner_expectation_count",
            "pending_multimodal_attachment_count",
            "attachment_document_count",
            "unsupported_binary_count",
        ):
            object.__setattr__(self, field_name, max(0, int(getattr(self, field_name) or 0)))

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> ConsumerAdmissionDecisionRecord:
        raw = dict(payload)
        raw["admission_reason_codes"] = tuple(raw.get("admission_reason_codes") or ())
        return cls(**raw)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumerAdmissionManifest:
    admission_run_id: str
    source_channel: str
    corpus: str
    collection: str
    selection_source: str
    selection_path: str
    selection_sha256: str
    scope_write_mode: str
    selected_notice_ids: tuple[str, ...]
    decision_records: tuple[ConsumerAdmissionDecisionRecord, ...]
    decision_counts: dict[str, int] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now)
    schema_version: str = CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION
    policy_version: str = CONSUMER_ADMISSION_POLICY_VERSION

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "schema_version",
            str(self.schema_version or "").strip(),
        )
        object.__setattr__(
            self,
            "policy_version",
            str(self.policy_version or "").strip(),
        )
        object.__setattr__(
            self,
            "admission_run_id",
            str(self.admission_run_id or "").strip(),
        )
        object.__setattr__(self, "source_channel", str(self.source_channel or "").strip())
        object.__setattr__(self, "corpus", str(self.corpus or "").strip())
        object.__setattr__(self, "collection", str(self.collection or "").strip())
        object.__setattr__(
            self,
            "selection_source",
            str(self.selection_source or "").strip(),
        )
        object.__setattr__(self, "selection_path", str(self.selection_path or "").strip())
        object.__setattr__(
            self,
            "selection_sha256",
            str(self.selection_sha256 or "").strip().lower(),
        )
        object.__setattr__(
            self,
            "scope_write_mode",
            str(self.scope_write_mode or "").strip(),
        )
        object.__setattr__(
            self,
            "selected_notice_ids",
            normalize_notice_ids(self.selected_notice_ids),
        )
        object.__setattr__(
            self,
            "decision_records",
            tuple(
                sorted(
                    (
                        item
                        if isinstance(item, ConsumerAdmissionDecisionRecord)
                        else ConsumerAdmissionDecisionRecord.from_dict(item)
                        for item in self.decision_records
                    ),
                    key=lambda item: item.notice_id,
                )
            ),
        )
        object.__setattr__(
            self,
            "decision_counts",
            {str(key): int(value) for key, value in dict(self.decision_counts).items()},
        )
        object.__setattr__(self, "created_at", str(self.created_at or "").strip())

    @classmethod
    def from_dict(cls, payload: Mapping[str, Any]) -> InternalNoticeConsumerAdmissionManifest:
        raw = dict(payload)
        raw["selected_notice_ids"] = tuple(raw.get("selected_notice_ids") or ())
        raw["decision_records"] = tuple(
            ConsumerAdmissionDecisionRecord.from_dict(dict(item))
            for item in list(raw.get("decision_records") or ())
            if isinstance(item, Mapping)
        )
        raw["decision_counts"] = dict(raw.get("decision_counts") or {})
        return cls(**raw)


def compute_consumer_admission_selection_sha256(
    selected_notice_ids: Sequence[str],
) -> str:
    payload = {
        "selected_notice_ids": list(normalize_notice_ids(selected_notice_ids)),
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_internal_notice_consumer_admission_manifest(
    path: Path,
) -> InternalNoticeConsumerAdmissionManifest:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("internal notice consumer admission manifest must be a JSON object")
    manifest = InternalNoticeConsumerAdmissionManifest.from_dict(payload)
    validate_internal_notice_consumer_admission_manifest(manifest)
    return manifest


def write_internal_notice_consumer_admission_manifest(
    path: Path,
    manifest: InternalNoticeConsumerAdmissionManifest,
) -> None:
    validate_internal_notice_consumer_admission_manifest(manifest)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(
        json.dumps(
            _manifest_to_payload(manifest),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def validate_internal_notice_consumer_admission_manifest(
    manifest: InternalNoticeConsumerAdmissionManifest,
) -> None:
    if manifest.schema_version != CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported consumer admission manifest schema_version: {manifest.schema_version!r}"
        )
    if manifest.policy_version != CONSUMER_ADMISSION_POLICY_VERSION:
        raise ValueError(
            f"unsupported consumer admission manifest policy_version: {manifest.policy_version!r}"
        )
    for field_name in (
        "admission_run_id",
        "source_channel",
        "corpus",
        "collection",
        "selection_source",
        "selection_sha256",
    ):
        if not str(getattr(manifest, field_name) or "").strip():
            raise ValueError(f"consumer admission manifest {field_name} is required")
    if manifest.scope_write_mode not in ALLOWED_CONSUMER_ADMISSION_SCOPE_WRITE_MODES:
        raise ValueError(
            "unsupported consumer admission manifest scope_write_mode: "
            f"{manifest.scope_write_mode!r}"
        )
    expected_sha256 = compute_consumer_admission_selection_sha256(manifest.selected_notice_ids)
    if manifest.selection_sha256 != expected_sha256:
        raise ValueError("consumer admission manifest selection_sha256 mismatch")
    record_ids = tuple(record.notice_id for record in manifest.decision_records)
    if len(record_ids) != len(set(record_ids)):
        raise ValueError("duplicate decision notice_id in consumer admission manifest")
    if set(record_ids) != set(manifest.selected_notice_ids):
        raise ValueError("consumer admission manifest selected_notice_ids mismatch decisions")
    for record in manifest.decision_records:
        _validate_decision_record(record)


def _validate_decision_record(record: ConsumerAdmissionDecisionRecord) -> None:
    if not record.notice_id:
        raise ValueError("consumer admission decision notice_id is required")
    if record.target_surface not in ALLOWED_CONSUMER_ADMISSION_TARGET_SURFACES:
        raise ValueError(
            f"unsupported consumer admission target_surface: {record.target_surface!r}"
        )
    if record.consumption_status not in ALLOWED_CONSUMER_ADMISSION_STATUSES:
        raise ValueError(
            f"unsupported consumer admission consumption_status: {record.consumption_status!r}"
        )
    if record.admission_decision not in ALLOWED_CONSUMER_ADMISSION_DECISIONS:
        raise ValueError(
            f"unsupported consumer admission admission_decision: {record.admission_decision!r}"
        )
    if not record.admission_reason_codes:
        raise ValueError("consumer admission decision admission_reason_codes is required")


def _manifest_to_payload(manifest: InternalNoticeConsumerAdmissionManifest) -> dict[str, Any]:
    payload = asdict(manifest)
    payload["decision_counts"] = _decision_counts(manifest)
    return payload


def _decision_counts(manifest: InternalNoticeConsumerAdmissionManifest) -> dict[str, int]:
    counts = Counter(manifest.decision_counts)
    counts.update(record.admission_decision for record in manifest.decision_records)
    counts.update(record.target_surface for record in manifest.decision_records)
    counts.update(record.consumption_status for record in manifest.decision_records)
    return dict(sorted((str(key), int(value)) for key, value in counts.items()))


__all__ = [
    "ALLOWED_CONSUMER_ADMISSION_DECISIONS",
    "ALLOWED_CONSUMER_ADMISSION_SCOPE_WRITE_MODES",
    "ALLOWED_CONSUMER_ADMISSION_STATUSES",
    "ALLOWED_CONSUMER_ADMISSION_TARGET_SURFACES",
    "CONSUMER_ADMISSION_BODY_QUALITY_EMPTY",
    "CONSUMER_ADMISSION_BODY_QUALITY_PRESENT",
    "CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY",
    "CONSUMER_ADMISSION_DECISION_ADMIT",
    "CONSUMER_ADMISSION_DECISION_BLOCK",
    "CONSUMER_ADMISSION_DECISION_NO_ADOPTION",
    "CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION",
    "CONSUMER_ADMISSION_POLICY_VERSION",
    "CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE",
    "CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED",
    "CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION",
    "ConsumerAdmissionDecisionRecord",
    "InternalNoticeConsumerAdmissionManifest",
    "compute_consumer_admission_selection_sha256",
    "load_internal_notice_consumer_admission_manifest",
    "validate_internal_notice_consumer_admission_manifest",
    "write_internal_notice_consumer_admission_manifest",
]
