from __future__ import annotations

import re
import unicodedata
from typing import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_collection,
)
from campus_ingestion_core.sparse import SparseEmbeddingModel
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.curriculum_query_resolution import (
    build_curriculum_document_support_query_text,
    filter_curriculum_query_sources,
    interpret_curriculum_query,
)
from campus_retrieval_core.evidence_ranking import query_targets_source_title
from campus_retrieval_core.models import RetrievalRequest

from .backend_qdrant_source_metadata import _is_curriculum_course_list_table_source

_OFFICIAL_WEB_REFERENCE_SUPPORT_QUERY_HINTS = {
    "学校概况": "三个校区 12个学科门类",
    "本科培养": "本科专业 强基计划",
    "博士后": "博士后科研流动站 合格率",
    "研究生培养": "12个学科门类 研究生招生培养单位",
    "学术名流": "历史学 社会学 民族学 人类学 语言学 音乐",
}
_DOCUMENT_SUPPORT_QUERY_SUFFIXES = (
    "怎么安排",
    "如何安排",
    "怎么修读",
    "如何修读",
    "怎么办理",
    "如何办理",
    "是多少",
    "有多少",
    "一共多少",
    "怎么授予",
    "如何授予",
    "什么要求",
    "几年",
    "多少",
    "怎么",
    "如何",
)


def _build_hybrid_prefetch(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
    query_filter: qdrant_models.Filter | None = None,
    build_qdrant_filter_fn,
) -> list[qdrant_models.Prefetch]:
    runtime_query_filter = query_filter or build_qdrant_filter_fn(request, profile=profile)
    query_text = request.query_text.strip()
    dense_limit = max(request.top_k, profile.dense_prefetch_limit)
    sparse_limit = max(request.top_k, profile.sparse_prefetch_limit)
    dense_query_text = _build_dense_query_text(
        query_text=query_text,
        instruction=profile.embedding_query_instruction,
    )
    prefetch = [
        qdrant_models.Prefetch(
            query=list(
                dense_query_embedding or embedding_model.get_query_embedding(dense_query_text)
            ),
            using=profile.qdrant_index_binding.dense_vector_name,
            filter=runtime_query_filter,
            limit=dense_limit,
        )
    ]
    sparse_query = sparse_embedding_model.build_query(query_text)
    if sparse_query is not None:
        prefetch.append(
            qdrant_models.Prefetch(
                query=sparse_query,
                using=profile.qdrant_index_binding.sparse_vector_name,
                filter=runtime_query_filter,
                limit=sparse_limit,
            )
        )
    return prefetch


def _build_dense_query_text(*, query_text: str, instruction: str) -> str:
    normalized_query = query_text.strip()
    normalized_instruction = instruction.strip()
    if not normalized_instruction:
        return normalized_query
    return f"Instruct: {normalized_instruction}\nQuery: {normalized_query}"


def _build_document_support_query_text(*, query_text: str, source: EvidenceSource) -> str:
    normalized_query = query_text.strip()
    if not normalized_query:
        return normalized_query
    if source.collection == "curriculum_plan" or source.doc_id.startswith("curriculum:"):
        focused_query = build_curriculum_document_support_query_text(
            query_text=normalized_query,
            source=source,
        )
        if focused_query != normalized_query:
            return _strip_document_support_query_noise(focused_query)
    official_web_support_query = _build_official_web_document_support_query_text(
        query_text=normalized_query,
        source=source,
    )
    if official_web_support_query:
        return official_web_support_query
    for candidate in _document_support_query_candidates(source):
        if candidate and candidate in normalized_query:
            focused_query = _strip_document_support_query_noise(
                normalized_query.replace(candidate, "", 1)
            )
            if focused_query:
                return focused_query
    return normalized_query


def _document_support_query_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates: list[str] = []
    explicit_title = source.source_title.strip()
    if explicit_title:
        candidates.append(explicit_title)
    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if doc_label:
        candidates.append(doc_label)
    if source.structural_path:
        candidates.append(source.structural_path[0].strip())
    return tuple(dict.fromkeys(candidate for candidate in candidates if candidate))


def _build_official_web_document_support_query_text(
    *, query_text: str, source: EvidenceSource
) -> str:
    if (
        source.source_channel != "official_web"
        or not is_official_web_stable_reference_like_collection(source.collection)
    ):
        return ""
    title = source.source_title.strip()
    hint = _OFFICIAL_WEB_REFERENCE_SUPPORT_QUERY_HINTS.get(title)
    if not title or hint is None:
        return ""
    if not query_targets_source_title(query_text=query_text, source=source):
        return ""
    return f"{title} {hint}".strip()


def _strip_document_support_query_noise(text: str) -> str:
    focused_query = text.strip().strip(" \t\r\n,，.。;；:：()（）[]【】《》\"'")
    focused_query = focused_query.rstrip("？?").strip()
    changed = True
    while focused_query and changed:
        changed = False
        for suffix in _DOCUMENT_SUPPORT_QUERY_SUFFIXES:
            if focused_query.endswith(suffix):
                focused_query = focused_query[: -len(suffix)].rstrip(" \t\r\n,，.。;；:：")
                focused_query = focused_query.rstrip("？?").strip()
                changed = True
                break
    return focused_query


def _build_rrf_query(profile: CollectionRuntimeProfile) -> qdrant_models.RrfQuery:
    return qdrant_models.RrfQuery(
        rrf=qdrant_models.Rrf(
            k=profile.rrf_k,
            weights=[profile.rrf_dense_weight, profile.rrf_sparse_weight],
        )
    )


def _merge_evidence_sources(
    *,
    preferred: Sequence[EvidenceSource],
    additional: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    merged: dict[str, EvidenceSource] = {source.chunk_id: source for source in preferred}
    for source in additional:
        existing = merged.get(source.chunk_id)
        if existing is None or source.score > existing.score:
            merged[source.chunk_id] = source
    return tuple(merged.values())


def _prefer_curriculum_semester_course_list_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return tuple(sources)
    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=query_text,
        sources=sources,
    )
    if not scope_applied or not scoped_sources:
        return tuple(sources)
    preferred_chunk_ids = {
        source.chunk_id
        for source in scoped_sources
        if _is_curriculum_course_list_table_source(source)
    }
    if not preferred_chunk_ids:
        return tuple(sources)
    preferred_sources = tuple(
        source for source in sources if source.chunk_id in preferred_chunk_ids
    )
    ordered_preferred_sources = _order_curriculum_semester_course_list_sources(
        semester_labels=interpretation.semester_labels,
        sources=preferred_sources,
    )
    remaining_sources = tuple(
        source for source in sources if source.chunk_id not in preferred_chunk_ids
    )
    return tuple((*ordered_preferred_sources, *remaining_sources))


def _order_curriculum_semester_course_list_sources(
    *,
    semester_labels: tuple[str, ...],
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if len(sources) <= 1:
        return tuple(sources)

    ranked_sources = sorted(
        enumerate(sources),
        key=lambda item: (
            -_curriculum_exact_semester_row_count(item[1], semester_labels=semester_labels),
            -_curriculum_related_semester_row_count(item[1], semester_labels=semester_labels),
            item[0],
        ),
    )
    primary: list[EvidenceSource] = []
    secondary: list[EvidenceSource] = []
    seen_sections: set[str] = set()
    for _, source in ranked_sources:
        section_key = _curriculum_course_list_section_key(source)
        if section_key not in seen_sections:
            primary.append(source)
            seen_sections.add(section_key)
            continue
        secondary.append(source)
    return tuple((*primary, *secondary))


def _curriculum_course_list_section_key(source: EvidenceSource) -> str:
    if source.structural_path:
        return source.structural_path[-1].strip() or source.chunk_id
    return source.chunk_id


def _curriculum_support_section_key(source: EvidenceSource) -> str:
    if source.structural_path:
        normalized_path = tuple(part.strip() for part in source.structural_path if part.strip())
        if normalized_path:
            return " > ".join(normalized_path)
    if source.detail_label.strip():
        return source.detail_label.strip()
    return source.chunk_id


def _curriculum_exact_semester_row_count(
    source: EvidenceSource,
    *,
    semester_labels: tuple[str, ...],
) -> int:
    if not semester_labels:
        return 0
    numeric_labels = _curriculum_semester_numeric_labels(semester_labels)
    if not numeric_labels:
        return 0
    count = 0
    for cell in _curriculum_semester_cells(source):
        if cell in numeric_labels:
            count += 1
    return count


def _curriculum_related_semester_row_count(
    source: EvidenceSource,
    *,
    semester_labels: tuple[str, ...],
) -> int:
    if not semester_labels:
        return 0
    normalized_labels = {
        unicodedata.normalize("NFKC", label).strip() for label in semester_labels if label.strip()
    }
    numeric_labels = _curriculum_semester_numeric_labels(semester_labels)
    if not normalized_labels and not numeric_labels:
        return 0
    count = 0
    for cell in _curriculum_semester_cells(source):
        normalized_cell = unicodedata.normalize("NFKC", cell).strip()
        if not normalized_cell:
            continue
        if normalized_cell in numeric_labels:
            continue
        if normalized_cell in normalized_labels:
            count += 1
            continue
        if any(label in normalized_cell for label in normalized_labels):
            count += 1
            continue
        if any(
            re.search(rf"(?<!\d){re.escape(label)}(?!\d)", normalized_cell)
            for label in numeric_labels
        ):
            count += 1
    return count


def _curriculum_semester_cells(source: EvidenceSource) -> tuple[str, ...]:
    cells: list[str] = []
    for line in unicodedata.normalize("NFKC", source.snippet).splitlines():
        if "|" not in line:
            continue
        columns = [part.strip() for part in line.split("|")]
        if len(columns) < 2:
            continue
        last_cell = columns[-1].strip()
        if not last_cell or "学期" in last_cell:
            continue
        cells.append(last_cell)
    return tuple(cells)


def _curriculum_semester_numeric_labels(semester_labels: tuple[str, ...]) -> tuple[str, ...]:
    numerals = {
        "第一学期": "1",
        "第二学期": "2",
        "第三学期": "3",
        "第四学期": "4",
        "第五学期": "5",
        "第六学期": "6",
        "第七学期": "7",
        "第八学期": "8",
        "第九学期": "9",
        "第十学期": "10",
    }
    return tuple(dict.fromkeys(numerals[label] for label in semester_labels if label in numerals))
