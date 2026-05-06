from __future__ import annotations

import logging
from threading import Lock

from campus_contracts import AuthorizedRetrievalFilter, PersonalizationHint
from campus_ingestion_core.corpus_profiles import load_runtime_profile

from campus_retrieval_core.backend_qdrant import QdrantRetrievalBackend, RetrievalBackendError
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.service_observations import (
    build_jsonl_retrieval_observation_sink,
    build_retrieval_observation_event_sink,
    emit_retrieval_observations,
)
from campus_retrieval_core.service_plan_execution import (
    ExecutableLiveLookupFn,
    ExecutableRerankFn,
    ExecutableRetrievalRequestFn,
    ReplanStepCallback,
)
from campus_retrieval_core.service_plan_execution import (
    execute_retrieval_plan as _execute_retrieval_plan,
)
from campus_retrieval_core.service_requests import build_single_step_plan
from campus_retrieval_core.settings import RetrievalSettings

_RUNTIME_BACKEND_CACHE: dict[RetrievalSettings, QdrantRetrievalBackend] = {}
_RUNTIME_BACKEND_CACHE_LOCK = Lock()
_LOGGER = logging.getLogger(__name__)


def build_retrieval_backend(
    settings: RetrievalSettings | None = None,
) -> QdrantRetrievalBackend:
    runtime_settings = settings or RetrievalSettings.from_env()
    try:
        if settings is not None:
            return QdrantRetrievalBackend(runtime_settings)
        with _RUNTIME_BACKEND_CACHE_LOCK:
            existing = _RUNTIME_BACKEND_CACHE.get(runtime_settings)
            if existing is not None:
                return existing
            backend = QdrantRetrievalBackend(runtime_settings)
            _RUNTIME_BACKEND_CACHE[runtime_settings] = backend
            return backend
    except Exception as exc:  # pragma: no cover
        raise RetrievalBackendError("failed to initialize retrieval backend") from exc


def retrieve_sources(
    query: str,
    *,
    corpus: str,
    collection: str,
    target_document_ids: tuple[str, ...] = (),
    target_version_ids: tuple[str, ...] = (),
    target_revision_track: str = "",
    preferred_document_ids: tuple[str, ...] = (),
    canonical_course_ids: tuple[str, ...] = (),
    canonical_course_family_ids: tuple[str, ...] = (),
    canonical_program_family_ids: tuple[str, ...] = (),
    authorized_filter: AuthorizedRetrievalFilter | None = None,
    personalization_hint: PersonalizationHint | None = None,
    top_k: int | None = None,
    backend: QdrantRetrievalBackend | None = None,
    observation_sink=None,
    observation_request_id: str = "",
    include_observation_query_text: bool = False,
):
    runtime_top_k = (
        top_k if top_k is not None else load_runtime_profile(corpus, collection).retrieval_top_k
    )
    request = RetrievalRequest(
        query_text=query,
        corpus=corpus,
        collection=collection,
        target_document_ids=target_document_ids,
        target_version_ids=target_version_ids,
        target_revision_track=target_revision_track,
        preferred_document_ids=preferred_document_ids,
        canonical_course_ids=canonical_course_ids,
        canonical_course_family_ids=canonical_course_family_ids,
        canonical_program_family_ids=canonical_program_family_ids,
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        top_k=runtime_top_k,
    )
    runtime_backend = backend or build_retrieval_backend()
    execution = execute_retrieval_plan(
        build_single_step_plan(request),
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        backend=runtime_backend,
        observation_sink=observation_sink,
        observation_request_id=observation_request_id,
        include_observation_query_text=include_observation_query_text,
    )
    return execution.merged_evidence


def execute_retrieval_plan(
    plan,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None = None,
    personalization_hint: PersonalizationHint | None = None,
    backend: QdrantRetrievalBackend | None = None,
    retrieve_step: ExecutableRetrievalRequestFn | None = None,
    retrieve_live_step: ExecutableLiveLookupFn | None = None,
    rerank_step: ExecutableRerankFn | None = None,
    replan_callback: ReplanStepCallback | None = None,
    observation_sink=None,
    observation_request_id: str = "",
    include_observation_query_text: bool = False,
):
    return _execute_retrieval_plan(
        plan,
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        backend=backend,
        retrieve_step=retrieve_step,
        retrieve_live_step=retrieve_live_step,
        rerank_step=rerank_step,
        replan_callback=replan_callback,
        observation_sink=observation_sink,
        observation_request_id=observation_request_id,
        include_observation_query_text=include_observation_query_text,
        build_retrieval_backend_fn=build_retrieval_backend,
        load_runtime_profile_fn=load_runtime_profile,
        emit_retrieval_observations_fn=emit_retrieval_observations,
        logger=_LOGGER,
    )


__all__ = [
    "build_jsonl_retrieval_observation_sink",
    "build_retrieval_backend",
    "build_retrieval_observation_event_sink",
    "execute_retrieval_plan",
    "retrieve_sources",
]
