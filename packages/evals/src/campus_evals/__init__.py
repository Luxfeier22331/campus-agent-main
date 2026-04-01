from campus_evals.benchmark import (
    RetrievalCaseMetrics,
    RetrievalBenchmarkRun,
    RetrievalHybridQueryCase,
    RetrievalHybridQueryDataset,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    load_retrieval_hybrid_query_dataset,
    load_retrieval_qrels_dataset,
    load_retrieval_benchmark_run,
    render_retrieval_summary_text,
    summarize_retrieval_metrics,
    validate_retrieval_hybrid_query_fixture,
)
from campus_evals.expectations import evaluate_case
from campus_evals.handbook_benchmark import (
    collect_repairable_handbook_benchmark_targets,
    repair_handbook_formal_benchmark,
    run_handbook_formal_benchmark,
)
from campus_evals.judge_adapters import (
    build_answer_rubric_adapter,
    build_default_handbook_supplemental_adapters_from_env,
    build_handbook_ragas_adapter,
    build_refusal_rubric_adapter,
    load_handbook_judge_rubrics,
)
from campus_evals.judge_gate import (
    build_metric_key,
    evaluate_judge_gate,
    load_judge_gate_policy,
)
from campus_evals.models import (
    CaseResult,
    DimensionResult,
    ExecutionResult,
    ExpectedSourceRef,
    GoldenCase,
    GraderPolicy,
    ObservedTrace,
    RunReport,
    SupplementalMetricSummary,
    SupplementalResult,
    SummaryCount,
    TraceExpectation,
    expected_source_ref,
)
from campus_evals.supplemental_http import (
    OpenAICompatibleHTTPEmbeddings,
    OpenAICompatibleResponsesLLM,
    OpenAICompatibleTextResponsesLLM,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
)
from campus_evals.ragas_adapter import (
    RagasProjection,
    RagasSupplementalAdapter,
    build_default_ragas_metric_names,
    build_ragas_dataset,
    build_ragas_projection,
    build_ragas_scorer,
    build_ragas_supplemental_adapter_from_env,
)
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    repair_live_benchmark_profile,
    run_live_benchmark_profile,
)
from campus_evals.runner import run_cases
from campus_evals.scenarios import (
    curriculum_error_gate_cases,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    handbook_error_gate_cases,
    handbook_regression_locked_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
)
from campus_evals.settings import JudgeLLMSettings, RagasSettings, SupplementalHTTPSettings


def build_curriculum_live_executor(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import build_curriculum_live_executor as _build

    return _build(*args, **kwargs)


def build_curriculum_live_profile(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import build_curriculum_live_profile as _build

    return _build(*args, **kwargs)


def build_handbook_live_profile(*args, **kwargs):
    from campus_evals.handbook_live_benchmark import build_handbook_live_profile as _build

    return _build(*args, **kwargs)


__all__ = [
    "BenchmarkProfile",
    "CaseResult",
    "DimensionResult",
    "ExecutionResult",
    "ExpectedSourceRef",
    "GoldenCase",
    "GraderPolicy",
    "JudgeLLMSettings",
    "ObservedTrace",
    "OpenAICompatibleHTTPEmbeddings",
    "OpenAICompatibleResponsesLLM",
    "OpenAICompatibleTextResponsesLLM",
    "RetrievalBenchmarkRun",
    "RetrievalCaseMetrics",
    "RetrievalHybridQueryCase",
    "RetrievalHybridQueryDataset",
    "RetrievalMetricSummary",
    "RetrievalObservedSource",
    "RetrievalQrelsCase",
    "RetrievalQrelsDataset",
    "RetrievalQrelsSourceRef",
    "RunReport",
    "RagasProjection",
    "RagasSettings",
    "RagasSupplementalAdapter",
    "SummaryCount",
    "SupplementalMetricSummary",
    "SupplementalResult",
    "SupplementalHTTPSettings",
    "TraceExpectation",
    "build_default_ragas_metric_names",
    "build_curriculum_live_executor",
    "build_curriculum_live_profile",
    "build_default_handbook_supplemental_adapters_from_env",
    "build_handbook_live_profile",
    "build_http_ragas_embeddings",
    "build_http_ragas_llm",
    "build_answer_rubric_adapter",
    "build_handbook_ragas_adapter",
    "build_metric_key",
    "build_refusal_rubric_adapter",
    "build_ragas_dataset",
    "build_ragas_projection",
    "build_ragas_scorer",
    "build_ragas_supplemental_adapter_from_env",
    "curriculum_error_gate_cases",
    "curriculum_regression_locked_cases",
    "curriculum_release_gate_cases",
    "curriculum_smoke_cases",
    "collect_repairable_handbook_benchmark_targets",
    "evaluate_judge_gate",
    "evaluate_retrieval_case",
    "evaluate_retrieval_run",
    "evaluate_case",
    "expected_source_ref",
    "load_retrieval_hybrid_query_dataset",
    "load_retrieval_benchmark_run",
    "load_handbook_judge_rubrics",
    "load_judge_gate_policy",
    "load_retrieval_qrels_dataset",
    "render_retrieval_summary_text",
    "repair_handbook_formal_benchmark",
    "repair_live_benchmark_profile",
    "run_handbook_formal_benchmark",
    "run_cases",
    "run_live_benchmark_profile",
    "handbook_error_gate_cases",
    "handbook_regression_locked_cases",
    "handbook_release_gate_cases",
    "handbook_smoke_cases",
    "summarize_retrieval_metrics",
    "validate_retrieval_hybrid_query_fixture",
]
