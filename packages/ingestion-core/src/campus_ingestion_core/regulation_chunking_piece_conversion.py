from __future__ import annotations

from collections.abc import Sequence

from campus_shared.regulation_semantic_registry import build_regulation_condition_group_id

from campus_ingestion_core.chunking import (
    ChunkProfile,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    chunk_structured_unit,
)
from campus_ingestion_core.chunking_context import resolve_display_budget as resolve_context_budget
from campus_ingestion_core.process_shared import StructuredUnit

from .regulation_chunking_shared import (
    _RegulationSegment,
    _without_overlap,
)


def _segments_to_pieces(
    *,
    unit: StructuredUnit,
    segments: Sequence[_RegulationSegment],
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    expanded_segments: list[_RegulationSegment] = []
    token_guardrail_profile = _without_overlap(chunk_profile)
    for segment in segments:
        segment_unit = StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=segment.text,
            anchor={**dict(unit.anchor), **segment.anchor},
            metadata={**dict(unit.metadata), **segment.metadata},
        )
        display_budget = (
            resolve_context_budget(unit=segment_unit, chunk_profile=chunk_profile)
            if _requires_context_aware_segment_budget(unit=unit)
            else chunk_profile.resolve_display_budget()
        )
        if chunk_profile.count_tokens(segment.text) <= display_budget.max_tokens:
            expanded_segments.append(segment)
            continue
        token_guardrail_pieces = chunk_structured_unit(
            unit=segment_unit,
            chunk_profile=token_guardrail_profile,
        )
        expanded_segments.extend(
            _RegulationSegment(
                text=piece.text,
                anchor=segment.anchor,
                metadata=segment.metadata,
                split_reason=piece.split_reason or segment.split_reason,
                boundary_rule=piece.boundary_rule or segment.boundary_rule,
            )
            for piece in token_guardrail_pieces
        )

    total = len(expanded_segments)
    return tuple(
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=segment.text,
            segment_index=index,
            segment_total=total,
            split_reason=segment.split_reason,
            boundary_rule=segment.boundary_rule,
            anchor=segment.anchor,
            metadata=_finalize_answer_ready_segment_metadata(
                metadata=segment.metadata,
                root_unit_id=unit.root_unit_id,
            ),
        )
        for index, segment in enumerate(expanded_segments, start=1)
    )


def _finalize_answer_ready_segment_metadata(
    *,
    metadata: dict[str, object],
    root_unit_id: str,
) -> dict[str, object]:
    if not root_unit_id:
        return metadata
    finalized = dict(metadata)
    condition_group_key = str(finalized.get("condition_group_key") or "").strip()
    if condition_group_key and not str(finalized.get("condition_group_id") or "").strip():
        finalized["condition_group_id"] = build_regulation_condition_group_id(
            parent_unit_id=root_unit_id,
            group_key=condition_group_key,
        ).value
    introduced_group_key = str(finalized.get("introduced_condition_group_key") or "").strip()
    if (
        introduced_group_key
        and not str(finalized.get("introduced_condition_group_id") or "").strip()
    ):
        finalized["introduced_condition_group_id"] = build_regulation_condition_group_id(
            parent_unit_id=root_unit_id,
            group_key=introduced_group_key,
        ).value
    finalized.pop("condition_group_key", None)
    finalized.pop("introduced_condition_group_key", None)
    return finalized


def _requires_context_aware_segment_budget(*, unit: StructuredUnit) -> bool:
    return (
        str(unit.metadata.get("source_channel") or "").strip() == "official_web"
        and str(unit.metadata.get("page_family") or "").strip() in {"article_detail"}
        and str(unit.metadata.get("promotion_class") or "").strip() == "formal_regulation"
    )
