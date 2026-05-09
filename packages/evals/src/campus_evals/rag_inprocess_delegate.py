from __future__ import annotations

from collections.abc import Callable

from campus_contracts import AgentRequest, AgentResponse, EvidenceBundle
from campus_rag_agent.rag_sdk_models import RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.service import delegate_to_rag_agent as _service_delegate_to_rag_agent
from campus_rag_agent.service_retrieval import retrieve_sources as _default_retriever

Retriever = Callable[..., EvidenceBundle]


def delegate_to_rag_agent_inprocess(
    request: AgentRequest,
    *,
    retriever: Retriever | None = None,
    prompt_executor=None,
    retrieval_observation_sink=None,
    include_retrieval_observation_query_text: bool = False,
) -> AgentResponse:
    effective_retriever = retriever or _default_retriever
    captured_bundle: EvidenceBundle | None = None

    def wrapped_retriever(*args, **kwargs):
        nonlocal captured_bundle
        captured_bundle = effective_retriever(*args, **kwargs)
        return captured_bundle

    return _service_delegate_to_rag_agent(
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
    from tests.agent.rag_agent_test_support import _default_grounded_runner_for_evidence

    return _default_grounded_runner_for_evidence(evidence)


__all__ = ["delegate_to_rag_agent_inprocess"]
