from __future__ import annotations

import argparse
from pathlib import Path
from typing import Callable

from campus_contracts import ErrorInfo, EvidenceBundle, RagRequestPayload, RagResultPayload, SpecialistRequest, SpecialistResponse
from campus_evals.handbook_benchmark import repair_handbook_formal_benchmark, run_handbook_formal_benchmark
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    accept_live_benchmark_profile,
    build_default_profile_http_settings,
    build_default_output_dir as build_shared_default_output_dir,
    build_parser_for_profile,
    main_for_profile,
)
from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace
from campus_evals.ragas_adapter import build_ragas_supplemental_adapter_from_env
from campus_evals.scenarios import curriculum_error_gate_cases, curriculum_release_gate_cases
from campus_rag_specialist import delegate_to_rag_agent
from campus_retrieval_core import RetrievalBackendError, retrieve_sources


RUN_PREFIX = "curriculum-plan-live-gate"
REPAIR_PREFIX = "curriculum-plan-live-gate-repair"
CURRICULUM_PLAN_LIVE_GATE_POLICY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "curriculum_plan_live_gate_policy.json"
)

Retriever = Callable[..., EvidenceBundle]
Delegate = Callable[..., SpecialistResponse]
_DETERMINISTIC_ERROR_RESPONSES = {
    "evidence_shaping_failure": ("evidence_shaping_failed", "deterministic evidence shaping failure"),
    "invalid_backend_contract": ("invalid_backend_contract", "deterministic invalid backend contract"),
}


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    return build_shared_default_output_dir(prefix=prefix, timestamp=timestamp)


def build_curriculum_live_executor(
    *,
    retriever: Retriever = retrieve_sources,
    delegate: Delegate = delegate_to_rag_agent,
) -> Callable[[GoldenCase], ExecutionResult]:
    def _execute(case: GoldenCase) -> ExecutionResult:
        retrieved_evidence: EvidenceBundle | None = None
        retrieval_called = False

        def _traced_retriever(*args, **kwargs) -> EvidenceBundle:
            nonlocal retrieved_evidence, retrieval_called
            retrieval_called = True
            retrieved_evidence = retriever(*args, **kwargs)
            return retrieved_evidence

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal=case.user_goal,
            payload=RagRequestPayload(scope=case.scope),
            actor=case.actor,
        )
        failure_mode = str(case.metadata.get("failure_mode") or "").strip()
        if failure_mode == "retrieval_backend_failure":
            def _raise_retrieval_backend_failure(*args, **kwargs) -> EvidenceBundle:
                nonlocal retrieval_called
                retrieval_called = True
                raise RetrievalBackendError("deterministic retrieval backend failure")

            response = delegate(request, retriever=_raise_retrieval_backend_failure)
        elif failure_mode in _DETERMINISTIC_ERROR_RESPONSES:
            retrieval_called = True
            retrieved_evidence = _build_empty_evidence(request)
            response = _build_deterministic_error_response(
                request,
                code=_DETERMINISTIC_ERROR_RESPONSES[failure_mode][0],
                message=_DETERMINISTIC_ERROR_RESPONSES[failure_mode][1],
            )
        else:
            response = delegate(request, retriever=_traced_retriever)
        supporting_sources = ()
        if isinstance(response.result, RagResultPayload):
            supporting_sources = tuple(response.result.evidence.sources)
        observed_trace = ObservedTrace(
            selected_scope=case.scope,
            retrieval_called=retrieval_called,
            clarification_emitted=response.status == "needs_clarification",
            error_path=response.status == "error",
            retrieved_sources=() if retrieved_evidence is None else tuple(retrieved_evidence.sources),
            supporting_sources=supporting_sources,
        )
        return ExecutionResult(response=response, observed_trace=observed_trace)

    return _execute


def _build_deterministic_error_response(
    request: SpecialistRequest,
    *,
    code: str,
    message: str,
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-specialist",
        status="error",
        confidence="low",
        result=RagResultPayload(evidence=_build_empty_evidence(request)),
        error=ErrorInfo(code=code, message=message, retryable=False),
    )


def _build_empty_evidence(request: SpecialistRequest) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=request.user_goal,
        corpus=request.payload.scope.corpus,
        collection=request.payload.scope.collection,
    )


def build_parser() -> argparse.ArgumentParser:
    return build_parser_for_profile(build_curriculum_live_profile())


def build_curriculum_live_profile(env: dict[str, str] | None = None) -> BenchmarkProfile:
    http_settings = build_default_profile_http_settings()
    return BenchmarkProfile(
        profile_id="curriculum_plan",
        benchmark_type="curriculum_live_gate",
        repair_benchmark_type="curriculum_live_gate_repair",
        run_prefix=RUN_PREFIX,
        repair_prefix=REPAIR_PREFIX,
        description="Run or repair curriculum_plan live benchmark against the live chain.",
        policy_path=CURRICULUM_PLAN_LIVE_GATE_POLICY_PATH,
        http_settings=http_settings,
        cases_factory=lambda: (*curriculum_release_gate_cases(), *curriculum_error_gate_cases()),
        executor_factory=build_curriculum_live_executor,
        supplemental_adapters_factory=lambda: (
            build_ragas_supplemental_adapter_from_env(env, http_settings=http_settings),
        ),
    )


def main(argv: list[str] | None = None) -> int:
    return main_for_profile(
        profile=build_curriculum_live_profile(),
        argv=argv,
        output_dir_builder=build_default_output_dir,
        run_benchmark_fn=run_handbook_formal_benchmark,
        repair_benchmark_fn=repair_handbook_formal_benchmark,
        accept_benchmark_fn=accept_live_benchmark_profile,
    )


if __name__ == "__main__":
    raise SystemExit(main())
