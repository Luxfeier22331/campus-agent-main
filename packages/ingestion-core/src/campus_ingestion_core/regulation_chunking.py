from __future__ import annotations

from campus_ingestion_core.chunking import (
    ChunkProfile,
    SemanticChunkPiece,
    StructuredUnitChunkInput,
    chunk_structured_unit,
    chunk_table_unit,
    clean_structured_text,
)
from campus_ingestion_core.process_shared import StructuredUnit
from campus_ingestion_core.regulation_answer_roles import (
    build_answer_role_metadata,
    build_table_answer_role_metadata,
)
from campus_ingestion_core.regulation_chunk_quality import is_regulation_body_role

from .regulation_chunking_answer_ready_grouping import _build_answer_ready_regulation_segments
from .regulation_chunking_list_helpers import _build_regulation_list_segments
from .regulation_chunking_piece_conversion import _segments_to_pieces
from .regulation_chunking_shared import (
    _TEXTUAL_REGULATION_UNIT_TYPES,
    _contextualize_short_subject_value,
    _RegulationSegment,
    _section_path,
    _structured_unit_chunk_input,
    _without_overlap,
)


def build_regulation_unit_pieces(
    unit: StructuredUnit,
    chunk_profile: ChunkProfile,
    *,
    require_regulation_body_role: bool = True,
    answer_ready_roles: bool = False,
) -> tuple[SemanticChunkPiece, ...]:
    if unit.unit_type == "table_unit":
        return _build_table_unit_pieces(unit=unit, chunk_profile=chunk_profile)
    if not _should_use_regulation_chunking(
        unit=unit,
        require_regulation_body_role=require_regulation_body_role,
    ):
        return _generic_unit_pieces(
            unit=unit,
            text=unit.text,
            chunk_profile=chunk_profile,
        )

    cleaned_text = clean_structured_text(unit_type=unit.unit_type, text=unit.text)
    if not cleaned_text:
        return ()

    contextualized_text = _contextualize_short_subject_value(
        text=cleaned_text,
        section_path=_section_path(unit.anchor),
    )
    if contextualized_text is not None:
        return _short_contextualized_piece(
            unit=unit,
            text=contextualized_text,
            answer_ready_roles=answer_ready_roles,
        )

    if answer_ready_roles:
        answer_ready_segments = _build_answer_ready_regulation_segments(
            unit=unit,
            text=cleaned_text,
            chunk_profile=chunk_profile,
        )
        if not answer_ready_segments:
            answer_ready_segments = _build_sentence_answer_ready_segments(
                text=cleaned_text,
            )
        if answer_ready_segments:
            return _segments_to_pieces(
                unit=unit,
                segments=answer_ready_segments,
                chunk_profile=chunk_profile,
            )
        return _generic_unit_pieces(
            unit=unit,
            text=cleaned_text,
            chunk_profile=chunk_profile,
        )

    list_segments = _build_regulation_list_segments(
        unit=unit,
        text=cleaned_text,
        chunk_profile=chunk_profile,
    )
    if list_segments:
        return _segments_to_pieces(
            unit=unit,
            segments=list_segments,
            chunk_profile=chunk_profile,
        )

    return _generic_unit_pieces(
        unit=unit,
        text=cleaned_text,
        chunk_profile=chunk_profile,
    )


def _should_use_regulation_chunking(
    *,
    unit: StructuredUnit,
    require_regulation_body_role: bool,
) -> bool:
    if require_regulation_body_role:
        return is_regulation_body_role(unit.metadata.get("content_role"))
    return unit.unit_type in _TEXTUAL_REGULATION_UNIT_TYPES


def _build_table_unit_pieces(
    *,
    unit: StructuredUnit,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    base_pieces = chunk_table_unit(
        unit=_structured_unit_chunk_input(unit),
        chunk_profile=_without_overlap(chunk_profile),
    )
    return tuple(
        SemanticChunkPiece(
            unit_type=piece.unit_type,
            root_unit_id=piece.root_unit_id,
            text=piece.text,
            segment_index=piece.segment_index,
            segment_total=piece.segment_total,
            split_reason=piece.split_reason,
            boundary_rule=piece.boundary_rule,
            anchor=piece.anchor,
            metadata={
                **piece.metadata,
                **build_table_answer_role_metadata(text=piece.text, metadata=unit.metadata),
            },
        )
        for piece in base_pieces
    )


def _short_contextualized_piece(
    *,
    unit: StructuredUnit,
    text: str,
    answer_ready_roles: bool,
) -> tuple[SemanticChunkPiece, ...]:
    return (
        SemanticChunkPiece(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=text,
            metadata=(
                build_answer_role_metadata(text=text, prefix_text="", role_hint=None)
                if answer_ready_roles
                else {}
            ),
        ),
    )


def _generic_unit_pieces(
    *,
    unit: StructuredUnit,
    text: str,
    chunk_profile: ChunkProfile,
) -> tuple[SemanticChunkPiece, ...]:
    return chunk_structured_unit(
        unit=StructuredUnitChunkInput(
            unit_type=unit.unit_type,
            root_unit_id=unit.root_unit_id,
            text=text,
            anchor=unit.anchor,
            metadata=unit.metadata,
        ),
        chunk_profile=_without_overlap(chunk_profile),
    )


def _build_sentence_answer_ready_segments(text: str) -> tuple[_RegulationSegment, ...]:
    sentences = _split_answer_ready_sentences(text)
    if len(sentences) < 2:
        return ()
    if not _looks_like_mixed_deadline_and_consequence_sentences(sentences):
        return ()
    segments: list[_RegulationSegment] = []
    for sentence in sentences:
        role_metadata = build_answer_role_metadata(
            text=sentence,
            prefix_text="",
            role_hint=None,
        )
        answer_role = str(role_metadata.get("answer_role") or "").strip()
        if answer_role == "supporting_detail":
            return ()
        segments.append(
            _RegulationSegment(
                text=sentence,
                anchor={},
                metadata=role_metadata,
                split_reason="structure_boundary",
                boundary_rule="regulation_answer_ready_sentence",
            )
        )
    return tuple(segments)


def _split_answer_ready_sentences(text: str) -> tuple[str, ...]:
    normalized = text.strip()
    if not normalized:
        return ()
    sentences: list[str] = []
    current: list[str] = []
    for char in normalized:
        current.append(char)
        if char not in "。；;":
            continue
        sentence = "".join(current).strip()
        if sentence:
            sentences.append(sentence)
        current = []
    trailing = "".join(current).strip()
    if trailing:
        sentences.append(trailing)
    return tuple(sentence for sentence in sentences if sentence)


def _looks_like_mixed_deadline_and_consequence_sentences(sentences: tuple[str, ...]) -> bool:
    has_deadline = False
    has_consequence = False
    for sentence in sentences:
        role = str(
            build_answer_role_metadata(
                text=sentence,
                prefix_text="",
                role_hint=None,
            ).get("answer_role")
            or ""
        )
        if role == "time_constraint" and any(marker in sentence for marker in ("申诉", "听证")):
            has_deadline = True
        if role == "exclusion_rule" and any(
            marker in sentence for marker in ("视为放弃", "不再受理")
        ):
            has_consequence = True
    return has_deadline and has_consequence


__all__ = ["build_regulation_unit_pieces"]
