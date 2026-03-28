from __future__ import annotations

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import load_runtime_profile

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings


def build_retrieval_backend(
    settings: RetrievalSettings | None = None,
) -> QdrantRetrievalBackend:
    runtime_settings = settings or RetrievalSettings.from_env()
    try:
        return QdrantRetrievalBackend(runtime_settings)
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("failed to initialize retrieval backend") from exc


def retrieve_sources(
    query: str,
    *,
    corpus: str,
    collection: str,
    campus_scope: str | None = None,
    acl_groups: tuple[str, ...] = (),
    top_k: int | None = None,
    backend: QdrantRetrievalBackend | None = None,
) -> EvidenceBundle:
    runtime_top_k = top_k if top_k is not None else load_runtime_profile(corpus, collection).retrieval_top_k
    request = RetrievalRequest(
        query_text=query,
        corpus=corpus,
        collection=collection,
        campus_scope=campus_scope,
        acl_groups=acl_groups,
        top_k=runtime_top_k,
    )
    runtime_backend = backend or build_retrieval_backend()
    return runtime_backend.retrieve(request)
