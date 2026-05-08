from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path

import httpx
from campus_contracts import (
    AgentRequest,
    AgentResponse,
    EvidenceBundle,
    RagRequestPayload,
    RagResultPayload,
)
from campus_retrieval_core import retrieve_sources

from campus_evals.app_api_chat_runtime import AppApiEvalClient, AppApiEvalClientSettings
from campus_evals.formal_benchmark import repair_formal_benchmark, run_formal_benchmark
from campus_evals.judge_adapters import build_default_handbook_supplemental_adapters_from_env
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
from campus_evals.rag_inprocess_delegate import delegate_to_rag_agent_inprocess
from campus_evals.scenarios import handbook_release_gate_cases

RUN_PREFIX = "student-handbook-formal-benchmark"
REPAIR_PREFIX = "student-handbook-formal-benchmark-repair"
LIVE_BENCHMARK_CASE_WORKERS = 2
LIVE_BENCHMARK_FAITHFULNESS_NLI_BATCH_SIZE = 6
STUDENT_HANDBOOK_JUDGE_GATE_POLICY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "student_handbook_judge_gate_policy.json"
)

Retriever = Callable[..., EvidenceBundle]
Delegate = Callable[..., AgentResponse]


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    return build_shared_default_output_dir(prefix=prefix, timestamp=timestamp)


def build_handbook_live_executor(
    *,
    settings: AppApiEvalClientSettings | None = None,
    env: dict[str, str] | None = None,
    default_timeout_seconds: float | None = None,
    client: httpx.Client | None = None,
) -> Callable[[GoldenCase], ExecutionResult]:
    return build_app_api_handbook_live_executor(
        settings=settings
        or AppApiEvalClientSettings.from_env(
            env,
            default_timeout_seconds=default_timeout_seconds or 15.0,
        ),
        client=client,
    )


def build_inprocess_handbook_live_executor(
    *,
    retriever: Retriever = retrieve_sources,
    delegate: Delegate = delegate_to_rag_agent_inprocess,
) -> Callable[[GoldenCase], ExecutionResult]:
    def _execute(case: GoldenCase) -> ExecutionResult:
        retrieved_evidence: EvidenceBundle | None = None
        retrieval_called = False

        def _traced_retriever(*args, **kwargs) -> EvidenceBundle:
            nonlocal retrieved_evidence, retrieval_called
            retrieval_called = True
            retrieved_evidence = retriever(*args, **kwargs)
            return retrieved_evidence

        request = AgentRequest(
            target="rag-agent",
            user_goal=case.user_goal,
            payload=RagRequestPayload(scope=case.scope, version_query=case.version_query),
            actor=case.actor,
        )
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


def build_app_api_handbook_live_executor(
    *,
    settings: AppApiEvalClientSettings,
    client: httpx.Client | None = None,
) -> Callable[[GoldenCase], ExecutionResult]:
    app_api_client = AppApiEvalClient(settings=settings, client=client)

    def _execute(case: GoldenCase) -> ExecutionResult:
        execution = app_api_client.execute_knowledge_request(case=case)
        return ExecutionResult(
            response=execution.response,
            observed_trace=execution.observed_trace,
            request_correlation=execution.request_correlation,
        )

    return _execute


def build_parser() -> argparse.ArgumentParser:
    return build_parser_for_profile(build_handbook_live_profile())


def build_handbook_live_profile(env: dict[str, str] | None = None) -> BenchmarkProfile:
    http_settings = build_default_profile_http_settings()
    return BenchmarkProfile(
        profile_id="student_rules",
        benchmark_type="formal_benchmark",
        repair_benchmark_type="formal_benchmark_repair",
        run_prefix=RUN_PREFIX,
        repair_prefix=REPAIR_PREFIX,
        description="Run or repair student_rules formal benchmark against the live chain.",
        policy_path=STUDENT_HANDBOOK_JUDGE_GATE_POLICY_PATH,
        http_settings=http_settings,
        case_workers=LIVE_BENCHMARK_CASE_WORKERS,
        cases_factory=lambda: handbook_release_gate_cases(),
        executor_factory=lambda: build_handbook_live_executor(
            env=env,
            default_timeout_seconds=http_settings.read_timeout_seconds,
        ),
        supplemental_adapters_factory=lambda: build_default_handbook_supplemental_adapters_from_env(
            env,
            http_settings=http_settings,
            faithfulness_nli_batch_size=LIVE_BENCHMARK_FAITHFULNESS_NLI_BATCH_SIZE,
        ),
        pass_policy_path_to_core=False,
        pass_benchmark_type_to_core=False,
        pass_repair_benchmark_type_to_core=False,
    )


def main(argv: list[str] | None = None) -> int:
    return main_for_profile(
        profile=build_handbook_live_profile(),
        argv=argv,
        output_dir_builder=build_default_output_dir,
        run_benchmark_fn=run_formal_benchmark,
        repair_benchmark_fn=repair_formal_benchmark,
        accept_benchmark_fn=accept_live_benchmark_profile,
    )


if __name__ == "__main__":
    raise SystemExit(main())
