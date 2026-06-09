from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

import httpx
from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    ErrorInfo,
    EvidenceBundle,
    RagRequestPayload,
    RagResultPayload,
)
from campus_retrieval_core import RetrievalBackendError, retrieve_sources

from campus_evals.app_api_chat_runtime import AppApiEvalClient, AppApiEvalClientSettings
from campus_evals.formal_benchmark import repair_formal_benchmark, run_formal_benchmark
from campus_evals.knowledge_inprocess_delegate import delegate_to_knowledge_capability_inprocess
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    accept_live_benchmark_profile,
    build_default_profile_http_settings,
    build_parser_for_profile,
    main_for_profile,
)
from campus_evals.live_benchmark import (
    build_default_output_dir as build_shared_default_output_dir,
)
from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace
from campus_evals.ragas_adapter import build_ragas_supplemental_adapter_from_env
from campus_evals.scenarios import curriculum_error_gate_cases, curriculum_release_gate_cases

RUN_PREFIX = "curriculum-plan-live-gate"
REPAIR_PREFIX = "curriculum-plan-live-gate-repair"
LIVE_BENCHMARK_CASE_WORKERS = 2
LIVE_BENCHMARK_FAITHFULNESS_NLI_BATCH_SIZE = 6
CURRICULUM_PLAN_LIVE_GATE_POLICY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "curriculum_plan_live_gate_policy.json"
)

Retriever = Callable[..., EvidenceBundle]
Delegate = Callable[..., CapabilityResponse]
_DETERMINISTIC_ERROR_RESPONSES = {
    "evidence_shaping_failure": (
        "evidence_shaping_failed",
        "deterministic evidence shaping failure",
    ),
    "invalid_backend_contract": (
        "invalid_backend_contract",
        "deterministic invalid backend contract",
    ),
}


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    return build_shared_default_output_dir(prefix=prefix, timestamp=timestamp)


def build_curriculum_live_executor(
    *,
    settings: AppApiEvalClientSettings | None = None,
    env: dict[str, str] | None = None,
    default_timeout_seconds: float | None = None,
    client: httpx.Client | None = None,
) -> Callable[[GoldenCase], ExecutionResult]:
    return build_app_api_curriculum_live_executor(
        settings=settings
        or AppApiEvalClientSettings.from_env(
            env,
            default_timeout_seconds=default_timeout_seconds or 15.0,
        ),
        client=client,
    )


def build_inprocess_curriculum_live_executor(
    *,
    retriever: Retriever = retrieve_sources,
    delegate: Delegate = delegate_to_knowledge_capability_inprocess,
) -> Callable[[GoldenCase], ExecutionResult]:
    def _execute(case: GoldenCase) -> ExecutionResult:
        retrieved_evidence: EvidenceBundle | None = None
        retrieval_called = False

        def _traced_retriever(*args, **kwargs) -> EvidenceBundle:
            nonlocal retrieved_evidence, retrieval_called
            retrieval_called = True
            retrieved_evidence = retriever(*args, **kwargs)
            return retrieved_evidence

        request = CapabilityRequest(
            capability="knowledge",
            user_goal=case.user_goal,
            payload=RagRequestPayload(scope=case.scope, version_query=case.version_query),
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
            retrieved_sources=()
            if retrieved_evidence is None
            else tuple(retrieved_evidence.sources),
            supporting_sources=supporting_sources,
        )
        return ExecutionResult(response=response, observed_trace=observed_trace)

    return _execute


def build_app_api_curriculum_live_executor(
    *,
    settings: AppApiEvalClientSettings,
    client: httpx.Client | None = None,
) -> Callable[[GoldenCase], ExecutionResult]:
    app_api_client = AppApiEvalClient(settings=settings, client=client)
    inprocess_executor = build_inprocess_curriculum_live_executor()

    def _execute(case: GoldenCase) -> ExecutionResult:
        failure_mode = str(case.metadata.get("failure_mode") or "").strip()
        if failure_mode:
            return inprocess_executor(case)
        execution = app_api_client.execute_knowledge_request(case=case)
        return ExecutionResult(
            response=execution.response,
            observed_trace=execution.observed_trace,
            request_correlation=execution.request_correlation,
        )

    return _execute


def _build_deterministic_error_response(
    request: CapabilityRequest,
    *,
    code: str,
    message: str,
) -> CapabilityResponse:
    return CapabilityResponse(
        capability="knowledge",
        status="error",
        confidence="low",
        result=RagResultPayload(evidence=_build_empty_evidence(request)),
        error=ErrorInfo(code=code, message=message, retryable=False),
    )


def _build_empty_evidence(request: CapabilityRequest) -> EvidenceBundle:
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
        case_workers=LIVE_BENCHMARK_CASE_WORKERS,
        cases_factory=lambda: (*curriculum_release_gate_cases(), *curriculum_error_gate_cases()),
        executor_factory=lambda: build_curriculum_live_executor(
            env=env,
            default_timeout_seconds=http_settings.read_timeout_seconds,
        ),
        supplemental_adapters_factory=lambda: (
            build_ragas_supplemental_adapter_from_env(
                env,
                http_settings=http_settings,
                faithfulness_nli_batch_size=LIVE_BENCHMARK_FAITHFULNESS_NLI_BATCH_SIZE,
            ),
        ),
    )


def main(argv: list[str] | None = None) -> int:
    return main_for_profile(
        profile=build_curriculum_live_profile(),
        argv=argv,
        output_dir_builder=build_default_output_dir,
        run_benchmark_fn=run_formal_benchmark,
        repair_benchmark_fn=repair_formal_benchmark,
        accept_benchmark_fn=accept_live_benchmark_profile,
    )


if __name__ == "__main__":
    raise SystemExit(main())
