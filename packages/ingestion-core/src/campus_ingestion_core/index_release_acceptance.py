from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from campus_contracts import AuthorizedRetrievalFilter, EvidenceBundle
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources
from campus_retrieval_core.backend_qdrant_filters import _build_qdrant_filter
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
            limit=max(top_k, self.runtime_profile.retrieval_top_k),
            with_payload=True,
            with_vectors=False,
            timeout=self.settings.qdrant_timeout_seconds,
        )
        return EvidenceBundle(
            query_text=query,
            corpus=corpus,
            collection=collection,
            sources=build_evidence_sources(self, response.points or ())[:top_k],
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


__all__ = [
    "QdrantPhysicalCollectionAcceptanceExecutor",
    "ReleaseRetrievalAcceptanceCase",
    "ReleaseRetrievalAcceptanceExecutor",
    "ReleaseRetrievalAcceptanceResult",
    "build_release_retrieval_acceptance_executor",
    "load_release_retrieval_acceptance_cases",
    "run_release_retrieval_acceptance",
]
