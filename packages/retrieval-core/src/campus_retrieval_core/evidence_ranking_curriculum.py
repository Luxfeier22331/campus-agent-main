from __future__ import annotations

import re
from collections.abc import Sequence

from campus_contracts import EvidenceSource

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .evidence_ranking_features import SourceRankingFeatures
from .evidence_ranking_text import normalize_text


def select_curriculum_lookup_support_sources(
    *,
    query_text: str,
    ranked_features: Sequence[SourceRankingFeatures],
    locked_doc_id: str,
    max_sources: int,
) -> tuple[EvidenceSource, ...]:
    if max_sources <= 0:
        return ()
    interpretation = interpret_curriculum_query(query_text)
    if (
        interpretation.intent_kind != "curriculum_lookup"
        or interpretation.curriculum_lookup_target == "course_map"
    ):
        return ()
    eligible_features = tuple(
        feature
        for feature in ranked_features
        if not locked_doc_id or feature.source.doc_id == locked_doc_id
    )
    if not eligible_features:
        return ()

    distinct_sections: dict[str, SourceRankingFeatures] = {}
    for feature in eligible_features:
        distinct_sections.setdefault(curriculum_support_section_key(feature.source), feature)

    selected_features = sorted(
        distinct_sections.values(),
        key=lambda feature: curriculum_lookup_section_sort_key(
            query_text=query_text,
            feature=feature,
        ),
    )
    selected_chunk_ids = {feature.source.chunk_id for feature in selected_features}
    remaining_features = tuple(
        feature
        for feature in eligible_features
        if feature.source.chunk_id not in selected_chunk_ids
    )
    ordered_features = (*selected_features, *remaining_features)
    return tuple(feature.source for feature in ordered_features[:max_sources])


def select_curriculum_fact_support_sources(
    *,
    query_text: str,
    ranked_features: Sequence[SourceRankingFeatures],
    locked_doc_id: str,
    max_sources: int,
) -> tuple[EvidenceSource, ...]:
    if max_sources <= 0 or not _query_asks_total_credits(query_text):
        return ()
    eligible_features = tuple(
        feature
        for feature in ranked_features
        if feature.source.collection == "curriculum_plan"
        and (not locked_doc_id or feature.source.doc_id == locked_doc_id)
    )
    fact_features = tuple(
        feature for feature in eligible_features if _source_has_total_credit_fact(feature.source)
    )
    if not fact_features:
        return ()
    selected_features = sorted(
        fact_features,
        key=lambda feature: _curriculum_total_credit_fact_sort_key(feature),
        reverse=True,
    )
    selected_chunk_ids = {feature.source.chunk_id for feature in selected_features}
    remaining_features = tuple(
        feature
        for feature in eligible_features
        if feature.source.chunk_id not in selected_chunk_ids
    )
    ordered_features = (*selected_features, *remaining_features)
    return tuple(feature.source for feature in ordered_features[:max_sources])


def curriculum_lookup_section_sort_key(
    *,
    query_text: str,
    feature: SourceRankingFeatures,
) -> tuple[int, int, float]:
    focus_priority = (
        0
        if curriculum_lookup_source_matches_query(query_text=query_text, source=feature.source)
        else 1
    )
    return (
        focus_priority,
        source_chunk_ordinal(feature.source),
        -feature.source.score,
    )


def curriculum_lookup_source_matches_query(*, query_text: str, source: EvidenceSource) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.curriculum_lookup_target == "course_map":
        query_terms = (normalize_text("课程地图"), normalize_text("拓扑图"))
    elif interpretation.curriculum_lookup_target == "course_settings":
        query_terms = (normalize_text("课程设置"),)
    elif interpretation.curriculum_lookup_target == "study_advice":
        query_terms = (normalize_text("修读建议"),)
    else:
        return False
    normalized_query = normalize_text(query_text)
    normalized_section = normalize_text(curriculum_support_section_text(source))
    return any(term in normalized_query and term in normalized_section for term in query_terms)


def curriculum_support_section_key(source: EvidenceSource) -> str:
    for part in reversed(source.structural_path):
        normalized = part.strip()
        if normalized:
            return normalized
    if source.detail_label.strip():
        return source.detail_label.strip()
    return source.chunk_id


def curriculum_support_section_text(source: EvidenceSource) -> str:
    return " ".join(
        part
        for part in (
            *source.structural_path,
            source.detail_label,
        )
        if part.strip()
    )


def source_chunk_ordinal(source: EvidenceSource) -> int:
    match = re.search(r"chunk-(\d+)", source.chunk_id)
    if match is None:
        return 1_000_000
    return int(match.group(1))


def _query_asks_total_credits(query_text: str) -> bool:
    normalized = normalize_text(query_text)
    return (
        "总学分" in normalized
        or "学分要求" in normalized
        or ("多少学分" in normalized and any(cue in normalized for cue in ("一共", "共", "总共")))
    )


def _source_has_total_credit_fact(source: EvidenceSource) -> bool:
    return _text_has_total_credit_fact(
        " ".join(
            part for part in (*source.structural_path, source.detail_label, source.snippet) if part
        )
    )


def _text_has_total_credit_fact(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False
    if "总学分" in normalized:
        return True
    if re.search(r"(?:^|[|｜])\s*合计\s*(?:[|｜]\s*)+[0-9]{1,3}(?:\.\d+)?\s*$", normalized):
        return True
    return bool(re.search(r"(?:合计|共计(?:获得)?|总计)\s*[0-9]{1,3}(?:\.\d+)?\s*学分", normalized))


def _curriculum_total_credit_fact_sort_key(
    feature: SourceRankingFeatures,
) -> tuple[int, int, int, int, float]:
    source = feature.source
    normalized = normalize_text(
        " ".join(
            part for part in (*source.structural_path, source.detail_label, source.snippet) if part
        )
    )
    return (
        2
        if re.search(r"(?:共计(?:获得)?|合计|总计)\s*[0-9]{1,3}(?:\.\d+)?\s*学分", normalized)
        else 0,
        1 if "总学分" in normalized else 0,
        1 if source.content_kind == "section_text" else 0,
        feature.content_support_count,
        source.score,
    )
