from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class InternalNoticeConsumptionProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class NoticeConsumptionProjectionUnitStatus:
    unit_id: str
    primary_role: str
    target_surface: str
    consumption_status: str
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class NoticeConsumptionProjectionStatus:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_count: int
    ready_unit_count: int
    held_unit_count: int
    pending_multimodal_unit_count: int
    no_adoption_unit_count: int
    has_target_ready_units: bool
    units: tuple[NoticeConsumptionProjectionUnitStatus, ...]
    source_multimodal_required_count: int = 0
    multimodal_skipped_low_value_count: int = 0
    multimodal_action_required_count: int = 0


@dataclass(frozen=True, slots=True)
class InternalNoticeProcessingGapUnit:
    source_notice_id: str
    unit_id: str
    primary_role: str
    semantic_owner: str
    target_surface: str
    consumption_status: str
    reasons: tuple[str, ...]
    consumer_admission_batch_id: str = ""


@dataclass(frozen=True, slots=True)
class InternalNoticeProcessingGapsReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_multimodal_processing_count: int
    authority_pending_count: int
    unsupported_count: int
    no_adoption_count: int
    ready_for_target_count: int
    retained_for_notice_query_count: int
    consumption_status_counts: dict[str, int]
    target_surface_counts: dict[str, int]
    gap_units: tuple[InternalNoticeProcessingGapUnit, ...]
    source_multimodal_required_count: int = 0
    multimodal_skipped_low_value_count: int = 0
    multimodal_action_required_count: int = 0


__all__ = [
    "InternalNoticeConsumptionProjectionObjectStore",
    "InternalNoticeProcessingGapUnit",
    "InternalNoticeProcessingGapsReport",
    "NoticeConsumptionProjectionStatus",
    "NoticeConsumptionProjectionUnitStatus",
]
