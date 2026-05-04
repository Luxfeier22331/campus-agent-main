from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle
from campus_retrieval_core.backend_qdrant_curriculum_rescue import rescue_curriculum_title_sources
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources
from campus_retrieval_core.backend_qdrant_filters import _build_qdrant_filter
from campus_retrieval_core.backend_qdrant_policies import (
    _apply_no_hit_policy,
    _apply_official_web_low_signal_policy,
    finalize_retrieval_sources,
)
from campus_retrieval_core.backend_qdrant_query import (
    _build_dense_query_text,
    _build_hybrid_prefetch,
    _build_rrf_query,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.sparse import (
    SparseEmbeddingModel,
    SparseEmbeddingSettings,
    build_sparse_embedding_model,
)

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


@dataclass(frozen=True, slots=True)
class ReleaseRetrievalAcceptanceCase:
    case_id: str
    corpus: str
    collection: str
    query: str
    top_k: int = 3
    expected_document_ids: tuple[str, ...] = field(default_factory=tuple)
    expected_version_ids: tuple[str, ...] = field(default_factory=tuple)
    expected_chunk_ids: tuple[str, ...] = field(default_factory=tuple)
    forbidden_document_ids: tuple[str, ...] = field(default_factory=tuple)
    expected_no_hit: bool = False
    target_document_ids: tuple[str, ...] = field(default_factory=tuple)
    target_version_ids: tuple[str, ...] = field(default_factory=tuple)
    target_revision_track: str = ""
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_level: str = "public"
    visibility_scope: str | None = None

    def __post_init__(self) -> None:
        for field_name in (
            "expected_document_ids",
            "expected_version_ids",
            "expected_chunk_ids",
            "forbidden_document_ids",
            "target_document_ids",
            "target_version_ids",
            "entitlement_groups",
        ):
            current = getattr(self, field_name)
            normalized = tuple(
                item.strip() for item in current if isinstance(item, str) and item.strip()
            )
            if normalized != current:
                object.__setattr__(self, field_name, normalized)
        for field_name in ("case_id", "corpus", "collection", "query", "target_revision_track"):
            current = getattr(self, field_name)
            if isinstance(current, str):
                normalized_text = current.strip()
                if normalized_text != current:
                    object.__setattr__(self, field_name, normalized_text)
        if not self.case_id:
            raise ValueError("acceptance case case_id must not be empty")
        if not self.corpus or not self.collection:
            raise ValueError(f"acceptance case {self.case_id} scope must not be empty")
        if not self.query:
            raise ValueError(f"acceptance case {self.case_id} query must not be empty")
        if self.top_k <= 0:
            raise ValueError(f"acceptance case {self.case_id} top_k must be greater than zero")
        if self.expected_no_hit and (
            self.expected_document_ids or self.expected_version_ids or self.expected_chunk_ids
        ):
            raise ValueError(
                f"acceptance case {self.case_id} cannot combine expected_no_hit with expected hits"
            )


@dataclass(frozen=True, slots=True)
class ReleaseRetrievalAcceptanceResult:
    status: str
    summary: dict[str, object]


@dataclass(frozen=True, slots=True)
class ReleaseQualityGateResult:
    status: str
    chunk_quality_status: str
    qrels_coverage_status: str
    release_metadata_consistency_status: str
    summary: dict[str, object]


@dataclass(frozen=True, slots=True)
class _ChunkQualityRow:
    chunk_id: str
    document_key: tuple[str, str, str, str]
    root_unit_id: str
    chunk_order: int | None
    segment_index: int | None
    segment_total: int | None


class ReleaseRetrievalAcceptanceExecutor(Protocol):
    def retrieve(
        self,
        *,
        physical_collection_name: str,
        corpus: str,
        collection: str,
        query: str,
        top_k: int,
        target_document_ids: tuple[str, ...],
        target_version_ids: tuple[str, ...],
        target_revision_track: str,
        entitlement_groups: tuple[str, ...],
        visibility_level: str,
        visibility_scope: str | None,
    ) -> EvidenceBundle: ...


@dataclass(slots=True)
class QdrantPhysicalCollectionAcceptanceExecutor:
    qdrant_client: QdrantClient
    settings: RetrievalSettings
    runtime_profile: CollectionRuntimeProfile
    embedding_model: object | None = None
    sparse_embedding_model: SparseEmbeddingModel | None = None

    def __post_init__(self) -> None:
        if self.embedding_model is None:
            self.embedding_model = build_embedding_model(
                EmbeddingSettings(
                    provider=self.settings.embedding_provider,
                    model=self.settings.embedding_model,
                    api_key=self.settings.embedding_api_key,
                    api_base=self.settings.embedding_base_url,
                    dimensions=self.settings.embedding_dimensions,
                )
            )
        if self.sparse_embedding_model is None:
            self.sparse_embedding_model = build_sparse_embedding_model(
                SparseEmbeddingSettings(
                    provider=self.settings.sparse_provider,
                    model=self.settings.sparse_model,
                    tokenizer=self.settings.sparse_tokenizer,
                    language=self.settings.sparse_language,
                )
            )

    def retrieve(
        self,
        *,
        physical_collection_name: str,
        corpus: str,
        collection: str,
        query: str,
        top_k: int,
        target_document_ids: tuple[str, ...],
        target_version_ids: tuple[str, ...],
        target_revision_track: str,
        entitlement_groups: tuple[str, ...],
        visibility_level: str,
        visibility_scope: str | None,
    ) -> EvidenceBundle:
        request = RetrievalRequest(
            query_text=query,
            corpus=corpus,
            collection=collection,
            target_document_ids=target_document_ids,
            target_version_ids=target_version_ids,
            target_revision_track=target_revision_track,
            authorized_filter=AuthorizedRetrievalFilter(
                entitlement_groups=entitlement_groups,
                visibility_level=visibility_level,
                visibility_scope=visibility_scope,
            ),
            top_k=top_k,
        )
        dense_query_text = _build_dense_query_text(
            query_text=request.query_text,
            instruction=self.runtime_profile.embedding_query_instruction,
        )
        dense_query_embedding = self.embedding_model.get_query_embedding(dense_query_text)
        response = self.qdrant_client.query_points(
            collection_name=physical_collection_name,
            prefetch=_build_hybrid_prefetch(
                request=request,
                profile=self.runtime_profile,
                embedding_model=self.embedding_model,
                sparse_embedding_model=self.sparse_embedding_model,
                dense_query_embedding=dense_query_embedding,
                build_qdrant_filter_fn=_build_qdrant_filter,
            ),
            query=_build_rrf_query(self.runtime_profile),
            limit=max(
                top_k,
                self.runtime_profile.retrieval_top_k,
                self.runtime_profile.document_support_limit,
            ),
            with_payload=True,
            with_vectors=False,
            timeout=_qdrant_http_timeout_seconds(self.settings.qdrant_timeout_seconds),
        )
        raw_sources = build_evidence_sources(self, response.points or ())
        rescued_sources = rescue_curriculum_title_sources(
            self,
            request=request,
            profile=self.runtime_profile,
            qdrant_collection_name=physical_collection_name,
            sources=raw_sources,
            timeout_seconds=_qdrant_http_timeout_seconds(self.settings.qdrant_timeout_seconds),
        )
        sources = _apply_no_hit_policy(
            profile=self.runtime_profile,
            query_text=request.query_text,
            sources=rescued_sources,
        )
        sources = _apply_official_web_low_signal_policy(
            profile=self.runtime_profile,
            query_text=request.query_text,
            sources=sources,
        )
        sources = finalize_retrieval_sources(
            profile=self.runtime_profile,
            query_text=request.query_text,
            sources=sources,
            preferred_document_ids=request.preferred_document_ids,
        )
        return EvidenceBundle(
            query_text=query,
            corpus=corpus,
            collection=collection,
            sources=sources[:top_k],
        )


def load_release_retrieval_acceptance_cases(
    path: str | Path,
    *,
    corpus: str,
    collection: str,
) -> tuple[ReleaseRetrievalAcceptanceCase, ...]:
    case_path = Path(path)
    if not case_path.exists():
        raise ValueError(f"retrieval acceptance case path does not exist: {case_path}")
    payload = json.loads(case_path.read_text(encoding="utf-8"))
    raw_cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(raw_cases, list):
        raise ValueError("retrieval acceptance case file must contain a cases list")
    cases = tuple(
        _coerce_case(raw_case)
        for raw_case in raw_cases
        if isinstance(raw_case, dict)
        and str(raw_case.get("corpus") or "").strip() == corpus
        and str(raw_case.get("collection") or "").strip() == collection
    )
    if not cases:
        raise ValueError(
            f"retrieval acceptance case file must contain at least one acceptance case for {corpus}/{collection}"
        )
    return cases


def run_release_retrieval_acceptance(
    *,
    cases: Sequence[ReleaseRetrievalAcceptanceCase],
    executor: ReleaseRetrievalAcceptanceExecutor,
    physical_collection_name: str,
) -> ReleaseRetrievalAcceptanceResult:
    rows: list[dict[str, object]] = []
    failed_case_ids: list[str] = []
    for case in cases:
        bundle = executor.retrieve(
            physical_collection_name=physical_collection_name,
            corpus=case.corpus,
            collection=case.collection,
            query=case.query,
            top_k=case.top_k,
            target_document_ids=case.target_document_ids,
            target_version_ids=case.target_version_ids,
            target_revision_track=case.target_revision_track,
            entitlement_groups=case.entitlement_groups,
            visibility_level=case.visibility_level,
            visibility_scope=case.visibility_scope,
        )
        row = _evaluate_case(case=case, bundle=bundle)
        rows.append(row)
        if row["status"] != "passed":
            failed_case_ids.append(case.case_id)
    status = "passed" if not failed_case_ids else "failed"
    return ReleaseRetrievalAcceptanceResult(
        status=status,
        summary={
            "status": status,
            "case_count": len(rows),
            "passed_case_count": len(rows) - len(failed_case_ids),
            "failed_case_count": len(failed_case_ids),
            "failed_case_ids": failed_case_ids,
            "cases": rows,
        },
    )


def build_release_retrieval_acceptance_executor(
    *,
    qdrant_client: QdrantClient,
    settings: RetrievalSettings,
    runtime_profile: CollectionRuntimeProfile,
    embedding_model: object | None = None,
    sparse_embedding_model: SparseEmbeddingModel | None = None,
) -> ReleaseRetrievalAcceptanceExecutor:
    return QdrantPhysicalCollectionAcceptanceExecutor(
        qdrant_client=qdrant_client,
        settings=settings,
        runtime_profile=runtime_profile,
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
    )


def evaluate_release_chunk_quality(
    *,
    chunks: Sequence[object],
    max_token_count: int,
    max_token_count_source: str = "explicit",
    max_token_count_by_unit_type: dict[str, int] | None = None,
    required_metadata_fields: Sequence[str] = ("root_unit_id", "chunk_policy_version"),
    qrels_coverage_issues: Sequence[str] = (),
    qrels_coverage_required: bool = True,
) -> ReleaseQualityGateResult:
    issues_by_chunk_id: dict[str, tuple[str, ...]] = {}
    seen_chunk_ids: set[str] = set()
    chunk_rows: list[_ChunkQualityRow] = []
    unit_type_budgets = dict(max_token_count_by_unit_type or {})
    for index, chunk in enumerate(chunks, start=1):
        chunk_id = _required_text(_chunk_value(chunk, "chunk_id")) or f"row-{index}"
        issues: list[str] = []
        for field_name in (
            "document_id",
            "version_id",
            "chunk_id",
            "chunk_order",
            "corpus",
            "collection",
            "text",
            "source_uri",
        ):
            if not _has_value(_chunk_value(chunk, field_name)):
                issues.append(f"missing_{field_name}")
        if chunk_id in seen_chunk_ids:
            issues.append("duplicate_chunk_id")
        seen_chunk_ids.add(chunk_id)
        metadata = _mapping_value(_chunk_value(chunk, "metadata"))
        anchor = _mapping_value(_chunk_value(chunk, "anchor"))
        for metadata_field in required_metadata_fields:
            if not (
                _has_value(_chunk_value(chunk, metadata_field))
                or _has_value(metadata.get(metadata_field))
                or _has_value(anchor.get(metadata_field))
            ):
                issues.append(f"missing_{metadata_field}")
        root_unit_id = (
            _required_text(_chunk_value(chunk, "root_unit_id"))
            or _required_text(metadata.get("root_unit_id"))
            or _required_text(anchor.get("root_unit_id"))
            or ""
        )
        token_count = _coerce_int(metadata.get("final_token_count"))
        if token_count is None:
            token_count = _count_tokens(str(_chunk_value(chunk, "text") or ""))
        unit_type = _required_text(metadata.get("unit_type")) or ""
        chunk_max_token_count = unit_type_budgets.get(unit_type, max_token_count)
        if chunk_max_token_count > 0 and token_count > chunk_max_token_count:
            issues.append("token_count_exceeds_budget")
        if unit_type == "attachment_ref":
            issues.append("attachment_ref_not_query_serving_chunk")
        if _is_heading_only_regulation_chunk(
            chunk=chunk,
            metadata=metadata,
            anchor=anchor,
            token_count=token_count,
        ):
            issues.append("heading_only_chunk")
        display_text = _required_text(metadata.get("display_text"))
        if display_text and not _contains_normalized_text(
            haystack=str(_chunk_value(chunk, "text") or ""),
            needle=display_text,
        ):
            issues.append("display_text_not_in_chunk_text")
        if _is_table_chunk_missing_context_or_header(metadata=metadata, anchor=anchor):
            issues.append("missing_table_context_or_header")
        chunk_rows.append(
            _ChunkQualityRow(
                chunk_id=chunk_id,
                document_key=(
                    str(_chunk_value(chunk, "corpus") or ""),
                    str(_chunk_value(chunk, "collection") or ""),
                    str(_chunk_value(chunk, "document_id") or ""),
                    str(_chunk_value(chunk, "version_id") or ""),
                ),
                root_unit_id=root_unit_id,
                chunk_order=_coerce_int(_chunk_value(chunk, "chunk_order")),
                segment_index=_coerce_int(metadata.get("segment_index")),
                segment_total=_coerce_int(metadata.get("segment_total")),
            )
        )
        chunk_rows.extend(
            _build_member_segment_quality_rows(
                chunk_id=chunk_id,
                chunk=chunk,
                metadata=metadata,
            )
        )
        if issues:
            issues_by_chunk_id[chunk_id] = tuple(dict.fromkeys(issues))
    _add_cross_chunk_quality_issues(
        issues_by_chunk_id=issues_by_chunk_id,
        chunk_rows=tuple(chunk_rows),
    )

    chunk_issue_count = sum(len(issues) for issues in issues_by_chunk_id.values())
    qrels_issues = tuple(str(issue) for issue in qrels_coverage_issues if str(issue).strip())
    chunk_quality_status = "passed" if chunk_issue_count == 0 else "failed"
    if not qrels_coverage_required:
        qrels_coverage_status = "not_applicable" if not qrels_issues else "failed"
    else:
        qrels_coverage_status = "passed" if not qrels_issues else "failed"
    release_metadata_consistency_status = "passed"
    status = (
        "passed"
        if chunk_quality_status == "passed"
        and qrels_coverage_status in {"passed", "not_applicable"}
        and release_metadata_consistency_status == "passed"
        else "failed"
    )
    return ReleaseQualityGateResult(
        status=status,
        chunk_quality_status=chunk_quality_status,
        qrels_coverage_status=qrels_coverage_status,
        release_metadata_consistency_status=release_metadata_consistency_status,
        summary={
            "status": status,
            "chunk_count": len(chunks),
            "chunk_quality_status": chunk_quality_status,
            "chunk_issue_count": chunk_issue_count,
            "issues_by_chunk_id": issues_by_chunk_id,
            "max_token_count": max_token_count,
            "max_token_count_source": max_token_count_source,
            "max_token_count_by_unit_type": dict(sorted(unit_type_budgets.items())),
            "required_metadata_fields": tuple(required_metadata_fields),
            "qrels_coverage_status": qrels_coverage_status,
            "qrels_coverage_issues": qrels_issues,
            "qrels_coverage_required": qrels_coverage_required,
            "release_metadata_consistency_status": release_metadata_consistency_status,
        },
    )


def _coerce_case(raw_case: dict[str, object]) -> ReleaseRetrievalAcceptanceCase:
    return ReleaseRetrievalAcceptanceCase(
        case_id=str(raw_case.get("case_id") or ""),
        corpus=str(raw_case.get("corpus") or ""),
        collection=str(raw_case.get("collection") or ""),
        query=str(raw_case.get("query") or ""),
        top_k=int(raw_case.get("top_k") or 3),
        expected_document_ids=_tuple_field(raw_case.get("expected_document_ids")),
        expected_version_ids=_tuple_field(raw_case.get("expected_version_ids")),
        expected_chunk_ids=_tuple_field(raw_case.get("expected_chunk_ids")),
        forbidden_document_ids=_tuple_field(raw_case.get("forbidden_document_ids")),
        expected_no_hit=bool(raw_case.get("expected_no_hit") or False),
        target_document_ids=_tuple_field(raw_case.get("target_document_ids")),
        target_version_ids=_tuple_field(raw_case.get("target_version_ids")),
        target_revision_track=str(raw_case.get("target_revision_track") or ""),
        entitlement_groups=_tuple_field(raw_case.get("entitlement_groups")),
        visibility_level=str(raw_case.get("visibility_level") or "public"),
        visibility_scope=(
            str(raw_case["visibility_scope"]).strip()
            if raw_case.get("visibility_scope") is not None
            else None
        ),
    )


def _evaluate_case(
    *,
    case: ReleaseRetrievalAcceptanceCase,
    bundle: EvidenceBundle,
) -> dict[str, object]:
    sources = tuple(bundle.sources or ())
    source_document_ids = {source.doc_id for source in sources}
    source_version_ids = {source.version_id for source in sources}
    source_chunk_ids = {source.chunk_id for source in sources}
    failures: list[str] = []

    if case.expected_no_hit:
        if sources:
            failures.append("expected_no_hit")
    else:
        if case.expected_document_ids and not set(case.expected_document_ids).issubset(
            source_document_ids
        ):
            failures.append("expected_document_ids")
        if case.expected_version_ids and not set(case.expected_version_ids).issubset(
            source_version_ids
        ):
            failures.append("expected_version_ids")
        if case.expected_chunk_ids and not set(case.expected_chunk_ids).issubset(source_chunk_ids):
            failures.append("expected_chunk_ids")
        if case.expected_document_ids and not any(
            source.canonical_url and source.latest_url for source in sources
        ):
            failures.append("evidence_back_link")

    forbidden_hits = sorted(set(case.forbidden_document_ids).intersection(source_document_ids))
    if forbidden_hits:
        failures.append("forbidden_document_ids")

    return {
        "case_id": case.case_id,
        "query": case.query,
        "status": "passed" if not failures else "failed",
        "failures": failures,
        "hit_count": len(sources),
        "hit_document_ids": sorted(source_document_ids),
        "hit_version_ids": sorted(source_version_ids),
        "hit_chunk_ids": sorted(source_chunk_ids),
        "forbidden_hits": forbidden_hits,
    }


def _tuple_field(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if not isinstance(value, list | tuple):
        raise ValueError("acceptance case list fields must be strings or lists")
    return tuple(str(item).strip() for item in value if str(item).strip())


def _qdrant_http_timeout_seconds(value: float | int | None) -> int | None:
    if value is None:
        return None
    return max(math.ceil(float(value)), 1)


def _chunk_value(chunk: object, field_name: str) -> object:
    if isinstance(chunk, dict):
        return chunk.get(field_name)
    return getattr(chunk, field_name, None)


def _mapping_value(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, Mapping) else {}


def _count_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _coerce_int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_heading_only_regulation_chunk(
    *,
    chunk: object,
    metadata: dict[str, object],
    anchor: dict[str, object],
    token_count: int,
) -> bool:
    if _chunk_value(chunk, "corpus") != "regulations":
        return False
    if str(metadata.get("unit_type") or "") != "section_text":
        return False
    text = str(_chunk_value(chunk, "text") or "").strip()
    if not text or "\n" in text or token_count > 16:
        return False
    section_path = tuple(str(item).strip() for item in anchor.get("section_path") or ())
    return bool(section_path and text == section_path[-1])


def _contains_normalized_text(*, haystack: str, needle: str) -> bool:
    normalized_haystack = _normalize_match_text(haystack)
    normalized_needle = _normalize_match_text(needle)
    return bool(normalized_needle and normalized_needle in normalized_haystack)


def _normalize_match_text(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def _is_table_chunk_missing_context_or_header(
    *,
    metadata: Mapping[str, object],
    anchor: Mapping[str, object],
) -> bool:
    unit_type = str(metadata.get("unit_type") or "")
    if unit_type not in {"table", "table_row", "table_unit"}:
        return False
    return not (
        _has_value(anchor.get("table_context"))
        or _has_value(metadata.get("table_context"))
        or _has_value(anchor.get("table_headers"))
        or _has_value(metadata.get("table_headers"))
        or _has_value(anchor.get("table_header_cells"))
        or _has_value(metadata.get("table_header_cells"))
        or _has_value(anchor.get("header_cells"))
        or _has_value(metadata.get("header_cells"))
        or _has_value(anchor.get("table_columns"))
        or _has_value(metadata.get("table_columns"))
    )


def _add_cross_chunk_quality_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    chunk_rows: Sequence[_ChunkQualityRow],
) -> None:
    rows_by_document: dict[tuple[str, str, str, str], list[_ChunkQualityRow]] = {}
    rows_by_root: dict[tuple[str, str, str, str, str], list[_ChunkQualityRow]] = {}
    for row in chunk_rows:
        rows_by_document.setdefault(row.document_key, []).append(row)
        if row.root_unit_id:
            rows_by_root.setdefault((*row.document_key, row.root_unit_id), []).append(row)
    for rows in rows_by_document.values():
        _add_chunk_order_issues(issues_by_chunk_id=issues_by_chunk_id, rows=tuple(rows))
    for rows in rows_by_root.values():
        _add_segment_coverage_issues(issues_by_chunk_id=issues_by_chunk_id, rows=tuple(rows))


def _build_member_segment_quality_rows(
    *,
    chunk_id: str,
    chunk: object,
    metadata: Mapping[str, object],
) -> tuple[_ChunkQualityRow, ...]:
    lineage = metadata.get("member_segment_lineage")
    if not isinstance(lineage, list | tuple):
        return ()
    document_key = (
        str(_chunk_value(chunk, "corpus") or ""),
        str(_chunk_value(chunk, "collection") or ""),
        str(_chunk_value(chunk, "document_id") or ""),
        str(_chunk_value(chunk, "version_id") or ""),
    )
    rows: list[_ChunkQualityRow] = []
    for item in lineage:
        if not isinstance(item, Mapping):
            continue
        root_unit_id = _required_text(item.get("root_unit_id")) or ""
        if not root_unit_id:
            continue
        rows.append(
            _ChunkQualityRow(
                chunk_id=chunk_id,
                document_key=document_key,
                root_unit_id=root_unit_id,
                chunk_order=None,
                segment_index=_coerce_int(item.get("segment_index")),
                segment_total=_coerce_int(item.get("segment_total")),
            )
        )
    return tuple(rows)


def _add_chunk_order_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    rows: Sequence[_ChunkQualityRow],
) -> None:
    ordered_rows = tuple(row for row in rows if row.chunk_order is not None)
    if not ordered_rows:
        return
    orders = [int(row.chunk_order) for row in ordered_rows if row.chunk_order is not None]
    if len(set(orders)) != len(orders):
        for row in ordered_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="duplicate_chunk_order",
            )
    if sorted(orders) != list(range(1, max(orders) + 1)):
        for row in ordered_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="chunk_order_gap",
            )


def _add_segment_coverage_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    rows: Sequence[_ChunkQualityRow],
) -> None:
    segmented_rows = _dedupe_segment_quality_rows(
        row for row in rows if row.segment_index is not None or row.segment_total is not None
    )
    if not segmented_rows:
        return
    invalid_rows = tuple(
        row
        for row in segmented_rows
        if row.segment_index is None
        or row.segment_total is None
        or row.segment_index <= 0
        or row.segment_total <= 0
        or row.segment_index > row.segment_total
    )
    for row in invalid_rows:
        _append_chunk_quality_issue(
            issues_by_chunk_id=issues_by_chunk_id,
            chunk_id=row.chunk_id,
            issue="invalid_segment_metadata",
        )
    valid_rows = tuple(row for row in segmented_rows if row not in invalid_rows)
    if not valid_rows:
        return
    segment_totals = {int(row.segment_total) for row in valid_rows if row.segment_total is not None}
    if len(segment_totals) != 1:
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="segment_total_mismatch",
            )
        return
    segment_total = next(iter(segment_totals))
    if segment_total <= 1:
        return
    segment_indexes = [
        int(row.segment_index) for row in valid_rows if row.segment_index is not None
    ]
    if len(set(segment_indexes)) != len(segment_indexes):
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="duplicate_segment_index",
            )
    if sorted(set(segment_indexes)) != list(range(1, segment_total + 1)):
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="segment_coverage_gap",
            )


def _dedupe_segment_quality_rows(
    rows: Iterable[_ChunkQualityRow],
) -> tuple[_ChunkQualityRow, ...]:
    deduped: list[_ChunkQualityRow] = []
    seen: set[tuple[str, int | None, int | None]] = set()
    for row in rows:
        key = (row.chunk_id, row.segment_index, row.segment_total)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return tuple(deduped)


def _append_chunk_quality_issue(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    chunk_id: str,
    issue: str,
) -> None:
    current = issues_by_chunk_id.get(chunk_id, ())
    if issue in current:
        return
    issues_by_chunk_id[chunk_id] = (*current, issue)


__all__ = [
    "QdrantPhysicalCollectionAcceptanceExecutor",
    "ReleaseQualityGateResult",
    "ReleaseRetrievalAcceptanceCase",
    "ReleaseRetrievalAcceptanceExecutor",
    "ReleaseRetrievalAcceptanceResult",
    "build_release_retrieval_acceptance_executor",
    "evaluate_release_chunk_quality",
    "load_release_retrieval_acceptance_cases",
    "run_release_retrieval_acceptance",
]
