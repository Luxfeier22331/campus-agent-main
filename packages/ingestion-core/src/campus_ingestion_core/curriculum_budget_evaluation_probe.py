from __future__ import annotations

import math
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from campus_ingestion_core.chunking import (
    CURRICULUM_CLEANING_POLICY_VERSION,
    ChunkProfile,
    CurriculumChunkingStrategy,
    build_chunk_text_context,
    build_curriculum_chunk_profile,
)
from campus_ingestion_core.curriculum_budget_evaluation_shared import (
    CurriculumBudgetAggregate,
    CurriculumBudgetCandidate,
    CurriculumBudgetCandidateResult,
    CurriculumBudgetDocumentResult,
    CurriculumBudgetEvaluationDocument,
    CurriculumBudgetIssueExample,
    CurriculumBudgetProbeCase,
    CurriculumBudgetProbeResult,
    CurriculumBudgetProbeSummary,
    CurriculumBudgetTokenSummary,
)
from campus_ingestion_core.curriculum_chunk_units import (
    _is_table_cue_row,
    _looks_like_curriculum_structure_heading,
    build_curriculum_structured_units,
    chunk_curriculum_unit,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import (
    _build_chunk_text,
    _ChunkCandidate,
    _ChunkMember,
    _merge_adjacent_curriculum_table_candidates,
    _merge_adjacent_short_textual_candidates,
)


@dataclass(frozen=True, slots=True)
class _EvaluatedDocument:
    result: CurriculumBudgetDocumentResult
    display_tokens: tuple[int, ...]
    final_tokens: tuple[int, ...]


def evaluate_candidate(
    *,
    candidate: CurriculumBudgetCandidate,
    documents: Sequence[CurriculumBudgetEvaluationDocument],
) -> CurriculumBudgetCandidateResult:
    evaluated_documents = tuple(
        _evaluate_document(candidate=candidate, document=document) for document in documents
    )
    document_results = tuple(item.result for item in evaluated_documents)
    tier_aggregates = {
        tier: _aggregate_evaluated_documents(
            tuple(item for item in evaluated_documents if item.result.tier == tier)
        )
        for tier in sorted({document.tier for document in document_results})
    }
    return CurriculumBudgetCandidateResult(
        name=candidate.name,
        default_profile=candidate.default_profile,
        table_profile=candidate.table_profile,
        aggregate=_aggregate_evaluated_documents(evaluated_documents),
        tier_aggregates=tier_aggregates,
        documents=document_results,
    )


def _evaluate_document(
    *,
    candidate: CurriculumBudgetCandidate,
    document: CurriculumBudgetEvaluationDocument,
) -> _EvaluatedDocument:
    units = build_curriculum_structured_units(
        record=document.record,
        structured_jsonl_bytes=document.structured_jsonl_bytes,
    )
    raw_candidates: list[_ChunkCandidate] = []
    unit_type_counts = Counter(unit.unit_type for unit in units)
    for unit in units:
        profile = _resolve_profile(
            candidate=candidate, record=document.record, unit_type=unit.unit_type
        )
        pieces = chunk_curriculum_unit(unit=unit, chunk_profile=profile)
        context_plan = build_chunk_text_context(anchor=unit.anchor, metadata=unit.metadata)
        for piece in pieces:
            chunk_assembly = _build_chunk_text(
                unit=unit,
                piece=piece,
                chunk_profile=profile,
                context_plan=context_plan,
            )
            raw_candidates.append(
                _ChunkCandidate(
                    unit_type=piece.unit_type,
                    root_unit_id=piece.root_unit_id,
                    source_chunk_id=unit.source_chunk_id,
                    visibility_level=unit.visibility_level,
                    anchor=dict(unit.anchor),
                    metadata=dict(unit.metadata),
                    piece=piece,
                    chunk_assembly=chunk_assembly,
                    members=(_ChunkMember(unit=unit, piece=piece),),
                )
            )
    merged = _merge_adjacent_short_textual_candidates(
        chunk_candidates=tuple(raw_candidates),
        chunk_profile=_resolve_profile(
            candidate=candidate, record=document.record, unit_type="section_text"
        ),
    )
    merged = _merge_adjacent_curriculum_table_candidates(
        chunk_candidates=merged,
        chunk_profile=_resolve_profile(
            candidate=candidate, record=document.record, unit_type="table_unit"
        ),
    )
    display_tokens: list[int] = []
    final_tokens: list[int] = []
    chunk_unit_type_counts: Counter[str] = Counter()
    oversize_chunk_count = 0
    orphan_heading_only_count = 0
    cue_only_chunk_count = 0
    missing_top_parent_count = 0
    missing_any_structural_heading_count = 0
    issue_examples: list[CurriculumBudgetIssueExample] = []
    probe_results = _evaluate_probe_cases(
        probe_cases=document.probe_cases,
        chunk_candidates=merged,
    )

    for chunk_order, chunk_candidate in enumerate(merged, start=1):
        unit_type = chunk_candidate.piece.unit_type
        profile = _resolve_profile(candidate=candidate, record=document.record, unit_type=unit_type)
        display_token_count = int(chunk_candidate.chunk_assembly.display_token_count)
        final_token_count = int(chunk_candidate.chunk_assembly.total_token_count)
        display_tokens.append(display_token_count)
        final_tokens.append(final_token_count)
        chunk_unit_type_counts[unit_type] += 1

        issue_types: list[str] = []
        if final_token_count > profile.max_chunk_size:
            oversize_chunk_count += 1
            issue_types.append("oversize")
        if _is_orphan_heading_only_chunk(chunk_candidate):
            orphan_heading_only_count += 1
            issue_types.append("orphan_heading_only")
        if _is_cue_only_chunk(chunk_candidate):
            cue_only_chunk_count += 1
            issue_types.append("cue_only")
        if _missing_top_parent_context(chunk_candidate):
            missing_top_parent_count += 1
            issue_types.append("missing_top_parent")
        if _missing_any_structural_heading(chunk_candidate):
            missing_any_structural_heading_count += 1
            issue_types.append("missing_any_structural_heading")
        if issue_types:
            issue_examples.append(
                CurriculumBudgetIssueExample(
                    chunk_order=chunk_order,
                    unit_type=unit_type,
                    issue_types=tuple(issue_types),
                    final_token_count=final_token_count,
                    budget_max=profile.max_chunk_size,
                    preview=_preview_text(chunk_candidate.chunk_assembly.text),
                )
            )

    return _EvaluatedDocument(
        result=CurriculumBudgetDocumentResult(
            tier=document.tier,
            label=document.label,
            document_id=document.record.document_id,
            title=document.title,
            total_units=len(units),
            total_chunks=len(merged),
            chunk_delta_vs_units=len(merged) - len(units),
            oversize_chunk_count=oversize_chunk_count,
            orphan_heading_only_count=orphan_heading_only_count,
            cue_only_chunk_count=cue_only_chunk_count,
            missing_top_parent_count=missing_top_parent_count,
            missing_any_structural_heading_count=missing_any_structural_heading_count,
            unit_type_counts=dict(sorted(unit_type_counts.items())),
            chunk_unit_type_counts=dict(sorted(chunk_unit_type_counts.items())),
            display_tokens=_summarize_tokens(display_tokens),
            final_tokens=_summarize_tokens(final_tokens),
            probe_summary=_summarize_probe_results(probe_results),
            probe_results=probe_results,
            issue_examples=tuple(issue_examples[:12]),
        ),
        display_tokens=tuple(display_tokens),
        final_tokens=tuple(final_tokens),
    )


def _resolve_profile(
    *,
    candidate: CurriculumBudgetCandidate,
    record: DocumentRegistryRecord,
    unit_type: str,
) -> ChunkProfile:
    profile_spec = (
        candidate.table_profile
        if unit_type == "table_unit" and candidate.table_profile is not None
        else candidate.default_profile
    )
    base_profile = build_curriculum_chunk_profile(model_name=record.embedding_model or None)
    return ChunkProfile(
        chunk_size=profile_spec.chunk_size,
        max_chunk_size=profile_spec.max_chunk_size,
        chunk_overlap=profile_spec.chunk_overlap,
        min_chunk_size=profile_spec.min_chunk_size,
        split_strategy=base_profile.split_strategy,
        chunk_policy_version=base_profile.chunk_policy_version,
        cleaning_policy_version=CURRICULUM_CLEANING_POLICY_VERSION,
        strategy_name=base_profile.strategy_name,
        strategy=CurriculumChunkingStrategy(),
        token_counter=base_profile.token_counter,
        tokenizer_name=base_profile.tokenizer_name,
        final_text_aware=base_profile.final_text_aware,
        safety_margin=base_profile.safety_margin,
    )


def _evaluate_probe_cases(
    *,
    probe_cases: tuple[CurriculumBudgetProbeCase, ...],
    chunk_candidates: Sequence[_ChunkCandidate],
) -> tuple[CurriculumBudgetProbeResult, ...]:
    if not probe_cases:
        return ()
    ranked_candidates = tuple(
        (index, candidate) for index, candidate in enumerate(chunk_candidates, start=1)
    )
    results: list[CurriculumBudgetProbeResult] = []
    for probe_case in probe_cases:
        ranked = sorted(
            (
                (
                    index,
                    candidate,
                    _curriculum_probe_score(probe_case.query, candidate.chunk_assembly.text),
                )
                for index, candidate in ranked_candidates
            ),
            key=lambda item: (item[2], -item[0]),
            reverse=True,
        )
        ranked = [item for item in ranked if item[2] > 0]
        top_ranked = ranked[0] if ranked else None
        top_chunk_order = top_ranked[0] if top_ranked is not None else None
        top_candidate = top_ranked[1] if top_ranked is not None else None
        top_score = round(float(top_ranked[2]), 3) if top_ranked is not None else 0.0
        keyword_hit_count = (
            _probe_keyword_hit_count(
                probe_case.expected_keywords, top_candidate.chunk_assembly.text
            )
            if top_candidate is not None
            else 0
        )
        keyword_hit_at_1 = (
            keyword_hit_count == len(probe_case.expected_keywords)
            if probe_case.expected_keywords
            else True
        )
        required_heading_hit_at_1 = (
            _probe_heading_hit(probe_case.required_headings, top_candidate.chunk_assembly.text)
            if top_candidate is not None
            else False
        )
        preferred_unit_type_hit_at_1 = (
            _probe_preferred_unit_type_hit(probe_case.preferred_unit_type, top_candidate)
            if top_candidate is not None
            else False
        )
        results.append(
            CurriculumBudgetProbeResult(
                case_id=probe_case.case_id,
                query=probe_case.query,
                top_chunk_order=top_chunk_order,
                top_unit_type=top_candidate.piece.unit_type if top_candidate is not None else None,
                top_score=top_score,
                keyword_hit_count=keyword_hit_count,
                expected_keyword_count=len(probe_case.expected_keywords),
                keyword_hit_at_1=keyword_hit_at_1,
                keyword_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate, probe_case=probe_case: _probe_keyword_hit(
                        probe_case.expected_keywords,
                        candidate.chunk_assembly.text,
                    ),
                ),
                required_heading_hit_at_1=required_heading_hit_at_1,
                required_heading_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate, probe_case=probe_case: _probe_heading_hit(
                        probe_case.required_headings,
                        candidate.chunk_assembly.text,
                    ),
                ),
                preferred_unit_type_hit_at_1=preferred_unit_type_hit_at_1,
                preferred_unit_type_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate, probe_case=probe_case: (
                        _probe_preferred_unit_type_hit(
                            probe_case.preferred_unit_type,
                            candidate,
                        )
                    ),
                ),
                complete_hit_at_1=(
                    keyword_hit_at_1 and required_heading_hit_at_1 and preferred_unit_type_hit_at_1
                ),
                complete_hit_at_3=_probe_any_hit_in_ranked(
                    ranked=ranked[:3],
                    predicate=lambda candidate, probe_case=probe_case: _probe_complete_hit(
                        probe_case,
                        candidate,
                    ),
                ),
                top_preview=_preview_text(top_candidate.chunk_assembly.text)
                if top_candidate is not None
                else "",
            )
        )
    return tuple(results)


def _curriculum_probe_score(query: str, text: str) -> float:
    normalized_query = _normalize_probe_text(query)
    normalized_text = _normalize_probe_text(text)
    if not normalized_query or not normalized_text:
        return 0.0
    query_unigrams = set(normalized_query)
    text_unigrams = set(normalized_text)
    query_bigrams = _build_character_ngrams(normalized_query, 2)
    text_bigrams = _build_character_ngrams(normalized_text, 2)
    query_trigrams = _build_character_ngrams(normalized_query, 3)
    text_trigrams = _build_character_ngrams(normalized_text, 3)
    exact_bonus = 24.0 if normalized_query in normalized_text else 0.0
    return (
        exact_bonus
        + float(len(query_trigrams & text_trigrams) * 8)
        + float(len(query_bigrams & text_bigrams) * 3)
        + float(len(query_unigrams & text_unigrams)) * 0.25
    )


def _normalize_probe_text(text: str) -> str:
    return "".join(
        char.lower() for char in text if char.isalnum() or ("\u4e00" <= char <= "\u9fff")
    )


def _build_character_ngrams(text: str, size: int) -> set[str]:
    if len(text) < size:
        return {text} if text else set()
    return {text[index : index + size] for index in range(len(text) - size + 1)}


def _probe_any_hit_in_ranked(
    *,
    ranked: Sequence[tuple[int, _ChunkCandidate, float]],
    predicate: Callable[[_ChunkCandidate], bool],
) -> bool:
    return any(predicate(candidate) for _, candidate, _ in ranked)


def _probe_keyword_hit(expected_keywords: tuple[str, ...], text: str) -> bool:
    if not expected_keywords:
        return True
    return all(keyword in text for keyword in expected_keywords)


def _probe_keyword_hit_count(expected_keywords: tuple[str, ...], text: str) -> int:
    return sum(1 for keyword in expected_keywords if keyword in text)


def _probe_heading_hit(required_headings: tuple[str, ...], text: str) -> bool:
    if not required_headings:
        return True
    return all(heading in text for heading in required_headings)


def _probe_preferred_unit_type_hit(
    preferred_unit_type: str | None,
    candidate: _ChunkCandidate,
) -> bool:
    if preferred_unit_type is None:
        return True
    return candidate.piece.unit_type == preferred_unit_type


def _probe_complete_hit(
    probe_case: CurriculumBudgetProbeCase,
    candidate: _ChunkCandidate,
) -> bool:
    text = candidate.chunk_assembly.text
    return (
        _probe_keyword_hit(probe_case.expected_keywords, text)
        and _probe_heading_hit(probe_case.required_headings, text)
        and _probe_preferred_unit_type_hit(probe_case.preferred_unit_type, candidate)
    )


def _summarize_probe_results(
    probe_results: tuple[CurriculumBudgetProbeResult, ...],
) -> CurriculumBudgetProbeSummary:
    return CurriculumBudgetProbeSummary(
        total_cases=len(probe_results),
        keyword_hit_at_1_count=sum(1 for item in probe_results if item.keyword_hit_at_1),
        keyword_hit_at_3_count=sum(1 for item in probe_results if item.keyword_hit_at_3),
        required_heading_hit_at_1_count=sum(
            1 for item in probe_results if item.required_heading_hit_at_1
        ),
        required_heading_hit_at_3_count=sum(
            1 for item in probe_results if item.required_heading_hit_at_3
        ),
        preferred_unit_type_hit_at_1_count=sum(
            1 for item in probe_results if item.preferred_unit_type_hit_at_1
        ),
        preferred_unit_type_hit_at_3_count=sum(
            1 for item in probe_results if item.preferred_unit_type_hit_at_3
        ),
        complete_hit_at_1_count=sum(1 for item in probe_results if item.complete_hit_at_1),
        complete_hit_at_3_count=sum(1 for item in probe_results if item.complete_hit_at_3),
    )


def _aggregate_probe_summaries(
    probe_summaries: tuple[CurriculumBudgetProbeSummary, ...],
) -> CurriculumBudgetProbeSummary:
    return CurriculumBudgetProbeSummary(
        total_cases=sum(item.total_cases for item in probe_summaries),
        keyword_hit_at_1_count=sum(item.keyword_hit_at_1_count for item in probe_summaries),
        keyword_hit_at_3_count=sum(item.keyword_hit_at_3_count for item in probe_summaries),
        required_heading_hit_at_1_count=sum(
            item.required_heading_hit_at_1_count for item in probe_summaries
        ),
        required_heading_hit_at_3_count=sum(
            item.required_heading_hit_at_3_count for item in probe_summaries
        ),
        preferred_unit_type_hit_at_1_count=sum(
            item.preferred_unit_type_hit_at_1_count for item in probe_summaries
        ),
        preferred_unit_type_hit_at_3_count=sum(
            item.preferred_unit_type_hit_at_3_count for item in probe_summaries
        ),
        complete_hit_at_1_count=sum(item.complete_hit_at_1_count for item in probe_summaries),
        complete_hit_at_3_count=sum(item.complete_hit_at_3_count for item in probe_summaries),
    )


def _aggregate_evaluated_documents(
    documents: Sequence[_EvaluatedDocument],
) -> CurriculumBudgetAggregate:
    display_values: list[int] = []
    final_values: list[int] = []
    for document in documents:
        display_values.extend(document.display_tokens)
        final_values.extend(document.final_tokens)
    return CurriculumBudgetAggregate(
        document_count=len(documents),
        total_units=sum(document.result.total_units for document in documents),
        total_chunks=sum(document.result.total_chunks for document in documents),
        chunk_delta_vs_units=sum(document.result.chunk_delta_vs_units for document in documents),
        oversize_chunk_count=sum(document.result.oversize_chunk_count for document in documents),
        orphan_heading_only_count=sum(
            document.result.orphan_heading_only_count for document in documents
        ),
        cue_only_chunk_count=sum(document.result.cue_only_chunk_count for document in documents),
        missing_top_parent_count=sum(
            document.result.missing_top_parent_count for document in documents
        ),
        missing_any_structural_heading_count=sum(
            document.result.missing_any_structural_heading_count for document in documents
        ),
        display_tokens=_summarize_tokens(display_values),
        final_tokens=_summarize_tokens(final_values),
        probe_summary=_aggregate_probe_summaries(
            tuple(document.result.probe_summary for document in documents)
        ),
    )


def _is_orphan_heading_only_chunk(chunk_candidate: _ChunkCandidate) -> bool:
    if chunk_candidate.piece.unit_type != "section_text":
        return False
    lines = [line.strip() for line in chunk_candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    return all(_is_pure_structure_heading_line(line) for line in lines)


def _is_cue_only_chunk(chunk_candidate: _ChunkCandidate) -> bool:
    if chunk_candidate.piece.unit_type != "table_unit":
        return False
    metadata = chunk_candidate.metadata
    lines = [line.strip() for line in chunk_candidate.piece.text.splitlines() if line.strip()]
    if not lines:
        return False
    caption_lines = {
        str(item).strip() for item in list(metadata.get("caption_lines") or ()) if str(item).strip()
    }
    note_lines = {
        str(item).strip() for item in list(metadata.get("note_lines") or ()) if str(item).strip()
    }
    header_line = str(metadata.get("table_header_line") or "").strip()
    content_lines = [
        line
        for line in lines
        if line not in caption_lines
        and line not in note_lines
        and line != header_line
        and not _looks_like_curriculum_structure_heading(line)
    ]
    if content_lines:
        return False
    return any(
        line in caption_lines or line == header_line or _is_table_cue_row(line) for line in lines
    )


def _missing_top_parent_context(chunk_candidate: _ChunkCandidate) -> bool:
    structural_path = _structural_section_path(chunk_candidate.anchor)
    if len(structural_path) < 2:
        return False
    return structural_path[0] not in chunk_candidate.chunk_assembly.text


def _missing_any_structural_heading(chunk_candidate: _ChunkCandidate) -> bool:
    structural_path = _structural_section_path(chunk_candidate.anchor)
    if not structural_path:
        return False
    text = chunk_candidate.chunk_assembly.text
    return not any(heading in text for heading in structural_path)


def _structural_section_path(anchor: dict[str, object]) -> list[str]:
    raw_path = [
        str(item).strip() for item in list(anchor.get("section_path") or []) if str(item).strip()
    ]
    if len(raw_path) > 1 and not _looks_like_curriculum_structure_heading(raw_path[0]):
        raw_path = raw_path[1:]
    return raw_path


def _is_pure_structure_heading_line(text: str) -> bool:
    normalized = text.strip()
    if not normalized or not _looks_like_curriculum_structure_heading(normalized):
        return False
    if any(token in normalized for token in ("。", ":", "：", ";", "；", ",", "，")):
        return False
    if len(normalized) > 48:
        return False
    return True


def _preview_text(text: str, *, limit: int = 120) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3] + "..."


def _summarize_tokens(values: list[int]) -> CurriculumBudgetTokenSummary:
    ordered = sorted(int(value) for value in values)
    if not ordered:
        return CurriculumBudgetTokenSummary(min=0, p50=0, p90=0, p95=0, p99=0, max=0)
    return CurriculumBudgetTokenSummary(
        min=ordered[0],
        p50=_percentile(ordered, 50),
        p90=_percentile(ordered, 90),
        p95=_percentile(ordered, 95),
        p99=_percentile(ordered, 99),
        max=ordered[-1],
    )


def _percentile(values: list[int], percentile: int) -> int:
    if not values:
        return 0
    rank = math.ceil((percentile / 100) * len(values)) - 1
    rank = min(max(rank, 0), len(values) - 1)
    return values[rank]


__all__ = ["evaluate_candidate"]
