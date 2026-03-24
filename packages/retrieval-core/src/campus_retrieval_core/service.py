from __future__ import annotations

from campus_contracts import DEFAULT_COLLECTION, DEFAULT_CORPUS, EvidenceBundle

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings


def retrieve_sources(
    query: str,
    *,
    corpus: str = DEFAULT_CORPUS,
    collection: str = DEFAULT_COLLECTION,
    campus_scope: str | None = None,
    acl_groups: tuple[str, ...] = (),
    top_k: int = 3,
    backend: QdrantRetrievalBackend | None = None,
) -> EvidenceBundle:
    request = RetrievalRequest(
        query_text=query,
        corpus=corpus,
        collection=collection,
        campus_scope=campus_scope,
        acl_groups=acl_groups,
        top_k=top_k,
    )
    try:
        runtime_backend = backend or QdrantRetrievalBackend(RetrievalSettings.from_env())
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("failed to initialize retrieval backend") from exc
    return runtime_backend.retrieve(request)
