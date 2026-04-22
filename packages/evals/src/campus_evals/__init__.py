from campus_evals.app_api_chat_runtime import (
    AppApiEvalClient,
    AppApiEvalClientError,
    AppApiEvalClientSettings,
    AppApiEvalExecution,
)
from campus_evals.benchmark import (
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalHybridQueryCase,
    RetrievalHybridQueryDataset,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_hybrid_query_dataset,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    resolve_retrieval_fixture_manifest_path,
    summarize_retrieval_metrics,
    validate_retrieval_hybrid_query_fixture,
    validate_retrieval_qrels_fixture,
)
from campus_evals.expectations import evaluate_case
from campus_evals.formal_benchmark import (
    collect_repairable_benchmark_targets,
    repair_formal_benchmark,
    run_formal_benchmark,
)
from campus_evals.judge_adapters import (
    build_answer_rubric_adapter,
    build_default_handbook_supplemental_adapters_from_env,
    build_handbook_ragas_adapter,
    build_json_judge,
    build_refusal_rubric_adapter,
    load_handbook_judge_rubrics,
)
from campus_evals.judge_gate import (
    build_metric_key,
    evaluate_judge_gate,
    load_judge_gate_policy,
)
from campus_evals.live_benchmark import (
    BenchmarkProfile,
    OperatorObservabilityPublishConfig,
    accept_live_benchmark_profile,
    repair_live_benchmark_profile,
    run_live_benchmark_profile,
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
    SummaryCount,
    SupplementalMetricSummary,
    SupplementalResult,
    TraceExpectation,
    expected_source_ref,
)
from campus_evals.official_web_inventory import (
    OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH,
    load_official_web_current_truth_inventory,
    official_web_current_truth_doc_ids_by_bucket,
    official_web_future_fresh_news_doc_ids,
    official_web_future_fresh_news_titles,
    official_web_inventory_only_doc_ids_by_disposition,
    official_web_inventory_only_titles_by_disposition,
    official_web_release_gate_doc_ids,
    official_web_retain_inventory_only_doc_ids,
    official_web_retain_inventory_only_titles,
)
from campus_evals.operator_observability import (
    OperatorObservabilityClient,
    OperatorObservabilityClientError,
    OperatorObservabilityClientSettings,
    OperatorPublishBatch,
    OperatorQualityGrade,
    OperatorRequestCorrelation,
    OperatorSkippedPublishItem,
    OperatorTraceBacklink,
    build_case_results_publish_batch,
    build_publish_parser,
    load_request_correlation_manifest,
    publish_case_results_artifact,
    render_publish_summary_text,
)
from campus_evals.operator_observability import (
    main as operator_observability_main,
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
    official_web_fresh_news_release_gate_cases,
    official_web_fresh_news_scope,
    official_web_release_gate_cases,
    official_web_stable_reference_release_gate_cases,
    official_web_stable_reference_scope,
    policy_risk_and_grounding_release_gate_cases,
    versioned_history_regression_locked_cases,
)
from campus_evals.settings import JudgeLLMSettings, RagasSettings, SupplementalHTTPSettings
from campus_evals.supplemental_http import (
    OpenAICompatibleChatCompletionsLLM,
    OpenAICompatibleHTTPEmbeddings,
    OpenAICompatibleResponsesLLM,
    OpenAICompatibleTextChatCompletionsLLM,
    OpenAICompatibleTextResponsesLLM,
    build_http_ragas_embeddings,
    build_http_ragas_llm,
)


def build_curriculum_live_executor(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import build_curriculum_live_executor as _build

    return _build(*args, **kwargs)


def build_app_api_curriculum_live_executor(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import (
        build_app_api_curriculum_live_executor as _build,
    )

    return _build(*args, **kwargs)


def build_legacy_curriculum_live_executor(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import (
        build_legacy_curriculum_live_executor as _build,
    )

    return _build(*args, **kwargs)


def build_curriculum_live_profile(*args, **kwargs):
    from campus_evals.curriculum_live_benchmark import build_curriculum_live_profile as _build

    return _build(*args, **kwargs)


def build_handbook_live_profile(*args, **kwargs):
    from campus_evals.handbook_live_benchmark import build_handbook_live_profile as _build

    return _build(*args, **kwargs)


def build_official_web_live_executor(*args, **kwargs):
    from campus_evals.official_web_live_benchmark import build_official_web_live_executor as _build

    return _build(*args, **kwargs)


def build_handbook_live_executor(*args, **kwargs):
    from campus_evals.handbook_live_benchmark import build_handbook_live_executor as _build

    return _build(*args, **kwargs)


def build_official_web_live_profile(*args, **kwargs):
    from campus_evals.official_web_live_benchmark import build_official_web_live_profile as _build

    return _build(*args, **kwargs)


def build_app_api_handbook_live_executor(*args, **kwargs):
    from campus_evals.handbook_live_benchmark import build_app_api_handbook_live_executor as _build

    return _build(*args, **kwargs)


def build_legacy_handbook_live_executor(*args, **kwargs):
    from campus_evals.handbook_live_benchmark import build_legacy_handbook_live_executor as _build

    return _build(*args, **kwargs)


__all__ = [
    "AppApiEvalClient",
    "AppApiEvalClientError",
    "AppApiEvalClientSettings",
    "AppApiEvalExecution",
    "BenchmarkProfile",
    "CaseResult",
    "DimensionResult",
    "ExecutionResult",
    "ExpectedSourceRef",
    "GoldenCase",
    "GraderPolicy",
    "JudgeLLMSettings",
    "OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH",
    "ObservedTrace",
    "OFFICIAL_WEB_CURRENT_TRUTH_INVENTORY_PATH",
    "OperatorObservabilityPublishConfig",
    "OpenAICompatibleHTTPEmbeddings",
    "OpenAICompatibleChatCompletionsLLM",
    "OpenAICompatibleResponsesLLM",
    "OpenAICompatibleTextChatCompletionsLLM",
    "OpenAICompatibleTextResponsesLLM",
    "OperatorObservabilityClient",
    "OperatorObservabilityClientError",
    "OperatorObservabilityClientSettings",
    "OperatorPublishBatch",
    "OperatorQualityGrade",
    "OperatorRequestCorrelation",
    "OperatorSkippedPublishItem",
    "OperatorTraceBacklink",
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
    "build_app_api_handbook_live_executor",
    "build_app_api_curriculum_live_executor",
    "build_default_ragas_metric_names",
    "build_curriculum_live_executor",
    "build_curriculum_live_profile",
    "build_default_handbook_supplemental_adapters_from_env",
    "build_handbook_live_executor",
    "build_handbook_live_profile",
    "build_official_web_live_executor",
    "build_official_web_live_profile",
    "build_legacy_curriculum_live_executor",
    "build_legacy_handbook_live_executor",
    "build_case_results_publish_batch",
    "build_publish_parser",
    "build_http_ragas_embeddings",
    "build_http_ragas_llm",
    "build_answer_rubric_adapter",
    "build_handbook_ragas_adapter",
    "build_json_judge",
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
    "collect_repairable_benchmark_targets",
    "evaluate_judge_gate",
    "evaluate_retrieval_case",
    "evaluate_retrieval_run",
    "evaluate_case",
    "expected_source_ref",
    "official_web_current_truth_doc_ids_by_bucket",
    "official_web_fresh_news_release_gate_cases",
    "official_web_fresh_news_scope",
    "official_web_future_fresh_news_doc_ids",
    "official_web_future_fresh_news_titles",
    "official_web_inventory_only_titles_by_disposition",
    "official_web_retain_inventory_only_doc_ids",
    "official_web_retain_inventory_only_titles",
    "load_retrieval_hybrid_query_dataset",
    "load_retrieval_benchmark_run",
    "load_handbook_judge_rubrics",
    "load_judge_gate_policy",
    "load_official_web_current_truth_inventory",
    "load_request_correlation_manifest",
    "load_retrieval_qrels_dataset",
    "operator_observability_main",
    "publish_case_results_artifact",
    "accept_live_benchmark_profile",
    "render_retrieval_summary_text",
    "render_publish_summary_text",
    "resolve_retrieval_fixture_manifest_path",
    "repair_formal_benchmark",
    "repair_live_benchmark_profile",
    "run_formal_benchmark",
    "run_cases",
    "run_live_benchmark_profile",
    "handbook_error_gate_cases",
    "handbook_regression_locked_cases",
    "handbook_release_gate_cases",
    "handbook_smoke_cases",
    "official_web_release_gate_cases",
    "official_web_stable_reference_release_gate_cases",
    "official_web_stable_reference_scope",
    "policy_risk_and_grounding_release_gate_cases",
    "versioned_history_regression_locked_cases",
    "official_web_inventory_only_doc_ids_by_disposition",
    "official_web_release_gate_doc_ids",
    "summarize_retrieval_metrics",
    "validate_retrieval_hybrid_query_fixture",
    "validate_retrieval_qrels_fixture",
]
