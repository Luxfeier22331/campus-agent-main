from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field, fields
from typing import Any, Protocol
from urllib.parse import urlsplit

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now

DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA = "ingestion_projection"
DEFAULT_SOURCE_TRUTH_INVENTORY_TABLE = (
    f"{DEFAULT_SOURCE_TRUTH_INVENTORY_SCHEMA}.authenticated_notice_source_truth_inventory"
)
DEFAULT_SOURCE_TRUTH_INVENTORY_ENV_KEY = "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_DATABASE_URL"
DEFAULT_SOURCE_TRUTH_INVENTORY_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_OPERATOR_DATABASE_URL"
)
DEFAULT_SOURCE_TRUTH_INVENTORY_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_SOURCE_TRUTH_INVENTORY_MANAGEMENT_DATABASE_URL"
)
AUTHENTICATED_NOTICE_SOURCE_TRUTH_BASE_WEIGHT = 1
AUTHENTICATED_NOTICE_SOURCE_TRUTH_TEXT_ATTACHMENT_WEIGHT = 1
AUTHENTICATED_NOTICE_SOURCE_TRUTH_OCR_ATTACHMENT_WEIGHT = 3
DEFAULT_SOURCE_TRUTH_INVENTORY_SCAN_PAGE_SIZE = 256
NOTICE_RISK_LABEL_BODY_ONLY = "body_only"
NOTICE_RISK_LABEL_REFERENCE_ONLY = "body_with_reference_only_attachments"
NOTICE_RISK_LABEL_TEXT_ATTACHMENTS = "body_with_text_attachments"
NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS = "body_with_spatial_attachments"
NOTICE_RISK_LABEL_MIXED_HIGH_RISK = "mixed_high_risk"
HIGH_RISK_NOTICE_LABELS = frozenset(
    {
        NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS,
        NOTICE_RISK_LABEL_MIXED_HIGH_RISK,
    }
)


class AuthenticatedNoticeSourceTruthInventoryObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthInventoryEntry:
    corpus: str
    collection: str
    notice_id: str
    site_id: str
    document_id: str
    revision_track: str
    version_id: str
    raw_asset_id: str
    raw_version_id: str
    source_home_url: str
    embedding_model: str
    notice_manifest_key: str
    content_blocks_key: str
    attachment_refs_key: str
    attachment_document_count: int
    attachment_ref_count: int
    text_extractable_count: int
    ocr_required_count: int
    reference_only_count: int
    multimodal_processing_required_count: int
    notice_risk_label: str
    attachment_mix_score: int
    has_text_table_attachment: bool
    has_spatial_attachment: bool
    has_reference_only_attachment: bool
    planning_weight: int
    updated_at: str = field(default_factory=utc_now)
    parent_snapshot: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeSourceTruthInventoryEntry:
        raw = dict(payload)
        raw["parent_snapshot"] = dict(raw.get("parent_snapshot") or {})
        raw["attachment_ref_count"] = int(raw.get("attachment_ref_count") or 0)
        raw["multimodal_processing_required_count"] = int(
            raw.get("multimodal_processing_required_count") or 0
        )
        raw["notice_risk_label"] = str(raw.get("notice_risk_label") or NOTICE_RISK_LABEL_BODY_ONLY)
        raw["attachment_mix_score"] = int(raw.get("attachment_mix_score") or 0)
        raw["has_text_table_attachment"] = _coerce_bool(raw.get("has_text_table_attachment"))
        raw["has_spatial_attachment"] = _coerce_bool(raw.get("has_spatial_attachment"))
        raw["has_reference_only_attachment"] = _coerce_bool(
            raw.get("has_reference_only_attachment")
        )
        allowed_field_names = {item.name for item in fields(cls)}
        raw = {key: value for key, value in raw.items() if key in allowed_field_names}
        return cls(**raw)


class AuthenticatedNoticeSourceTruthInventoryStore(Protocol):
    def upsert_many(
        self,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None: ...

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    ) -> None: ...

    def list_by_scope(
        self,
        corpus: str,
        collection: str,
        *,
        notice_ids: Sequence[str] = (),
    ) -> tuple[AuthenticatedNoticeSourceTruthInventoryEntry, ...]: ...


def _extract_notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) < 3 or parts[0] != "notice" or not parts[2]:
        raise ValueError(
            f"authenticated notice source inventory requires notice document ids: {document_id}"
        )
    return parts[2]


def _derive_notice_risk_label(
    *,
    attachment_ref_count: int,
    has_text_table_attachment: bool,
    has_spatial_attachment: bool,
    has_reference_only_attachment: bool,
) -> str:
    if attachment_ref_count <= 0:
        return NOTICE_RISK_LABEL_BODY_ONLY
    if has_spatial_attachment and (has_text_table_attachment or has_reference_only_attachment):
        return NOTICE_RISK_LABEL_MIXED_HIGH_RISK
    if has_spatial_attachment:
        return NOTICE_RISK_LABEL_SPATIAL_ATTACHMENTS
    if has_text_table_attachment:
        return NOTICE_RISK_LABEL_TEXT_ATTACHMENTS
    if has_reference_only_attachment:
        return NOTICE_RISK_LABEL_REFERENCE_ONLY
    return NOTICE_RISK_LABEL_BODY_ONLY


def _aggregate_notice_risk_counts(labels: Sequence[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for label in labels:
        normalized = str(label).strip() or NOTICE_RISK_LABEL_BODY_ONLY
        counts[normalized] = counts.get(normalized, 0) + 1
    return dict(sorted(counts.items()))


def _normalize_notice_type_names(value: object) -> list[str]:
    normalized: list[str] = []
    for item in value or ():
        text = _normalize_non_empty_text(item)
        if text is not None:
            normalized.append(text)
    return normalized


def _coerce_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes"}:
            return True
        if normalized in {"0", "false", "no", ""}:
            return False
    return bool(value)


def _derive_source_home_url(source_uri: str) -> str:
    normalized = source_uri.strip()
    parsed = urlsplit(normalized)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return normalized


def _normalize_non_empty_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None
