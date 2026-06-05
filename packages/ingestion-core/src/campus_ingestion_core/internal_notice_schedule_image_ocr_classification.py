from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import (
    _GUIDE_HINTS,
    _ROUTE_HINTS,
    _TEMPORAL_SCOPE_HINT_RE,
    _TIME_RE,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import _compact


def classify_schedule_image_ocr_result(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> str:
    if result.confidence == "low":
        return "low_confidence"
    combined_text = _combined_text(evidence, result)
    has_contextual_schedule_table = any(_table_has_time(table) for table in result.tables) and (
        _has_route_hint(combined_text)
    )
    if _has_schedule_table(result) or has_contextual_schedule_table:
        if evidence.image_use == "mixed_schedule_and_guide_image" or _contains_guide_hint(
            combined_text
        ):
            return "mixed_schedule_and_guide"
        return "extractable_schedule_table"
    if _has_route_hint(combined_text):
        return "route_or_boarding_only"
    return "low_confidence"


def _has_schedule_table(result: ScheduleImageOcrProviderResult) -> bool:
    return any(_table_has_time(table) and _table_has_route(table) for table in result.tables)


def _has_time(result: ScheduleImageOcrProviderResult) -> bool:
    if _TIME_RE.search(result.extracted_text):
        return True
    return any(_table_has_time(table) for table in result.tables)


def _table_has_time(table: Sequence[Sequence[str]]) -> bool:
    return any(_TIME_RE.search(str(cell or "")) for row in table for cell in row)


def _table_has_route(table: Sequence[Sequence[str]]) -> bool:
    text = _compact(" ".join(str(cell or "") for row in table for cell in row))
    return any(hint in text for hint in _ROUTE_HINTS)


def _has_route_hint(text: str) -> bool:
    compact = _compact(text)
    return any(hint in compact for hint in _ROUTE_HINTS)


def _has_temporal_scope_hint(text: str) -> bool:
    return bool(_TEMPORAL_SCOPE_HINT_RE.search(text))


def _contains_guide_hint(text: str) -> bool:
    return any(hint in text for hint in _GUIDE_HINTS)


def _combined_text(
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
) -> str:
    table_text = "\n".join(
        " ".join(str(cell or "") for cell in row) for table in result.tables for row in table
    )
    return "\n".join(
        (
            evidence.notice_title,
            evidence.context_before,
            result.extracted_text,
            table_text,
            evidence.context_after,
        )
    )
