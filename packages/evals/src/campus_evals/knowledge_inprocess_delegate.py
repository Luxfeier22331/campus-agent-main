from __future__ import annotations

from collections.abc import Callable

from campus_contracts import CapabilityRequest, CapabilityResponse, EvidenceBundle
from campus_knowledge_capability.rag_sdk_models import RagSdkRunRequest, RagSdkRunResult
from campus_knowledge_capability.service import (
    delegate_to_knowledge_capability as _service_delegate_to_knowledge_capability,
)
from campus_knowledge_capability.service_retrieval import retrieve_sources as _default_retriever

Retriever = Callable[..., EvidenceBundle]


def delegate_to_knowledge_capability_inprocess(
    request: CapabilityRequest,
    *,
    retriever: Retriever | None = None,
    prompt_executor=None,
    retrieval_observation_sink=None,
    include_retrieval_observation_query_text: bool = False,
) -> CapabilityResponse:
    effective_retriever = retriever or _default_retriever
    captured_bundle: EvidenceBundle | None = None
    captured_sources_by_chunk_id = {}

    def wrapped_retriever(*args, **kwargs):
        nonlocal captured_bundle
        retrieved_bundle = effective_retriever(*args, **kwargs)
        for source in retrieved_bundle.sources:
            captured_sources_by_chunk_id[source.chunk_id] = source
        captured_bundle = EvidenceBundle(
            query_text=retrieved_bundle.query_text,
            corpus=retrieved_bundle.corpus,
            collection=retrieved_bundle.collection,
            sources=tuple(captured_sources_by_chunk_id.values()),
        )
        return captured_bundle

    return _service_delegate_to_knowledge_capability(
        request,
        retriever=wrapped_retriever,
        prompt_executor=prompt_executor,
        retrieval_observation_sink=retrieval_observation_sink,
        include_retrieval_observation_query_text=include_retrieval_observation_query_text,
        rag_sdk_runner=_deferred_default_grounded_runner(lambda: captured_bundle),
    )


def _deferred_default_grounded_runner(bundle_ref):
    def runner(request: RagSdkRunRequest) -> RagSdkRunResult:
        evidence = bundle_ref()
        if evidence is None:
            raise RuntimeError("inprocess rag sdk runner called before retrieval evidence")
        return _test_support_grounded_runner_for_evidence(evidence)(request)

    return runner


def _test_support_grounded_runner_for_evidence(evidence: EvidenceBundle):
    from tests.agent.knowledge_capability_test_support import _default_grounded_runner_for_evidence

    return _default_grounded_runner_for_evidence(evidence)


__all__ = ["delegate_to_knowledge_capability_inprocess"]
