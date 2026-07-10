export type Check = Record<string, unknown> & { check_id: string; passed: boolean };

export const scoreRegistryPath =
	"packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json";
export const evalMapPath = "docs/reference/eval-map.md";
export const langfuseCliPath = "packages/eval-langfuse/src/cli.ts";
export const ragAssetRoot = "packages/eval-langfuse/assets";
export const ciInternalSurfaceDetectorPath = "tools/repo-static/detect_changed_surfaces.ts";
export const langfuseRuntimeContractPath = "docs/contracts/langfuse-runtime.md";
export const appApiEvalIngressContractPath = "docs/contracts/app-api/eval-benchmark.md";
export const traceEvidencePath = "packages/eval-langfuse/src/trace-evidence.ts";
export const otelTaxonomyPath = "docs/reference/runtime-otel-telemetry-taxonomy.md";

export const activeDocTokenScanPaths = ["docs/contracts", "docs/reference", "docs/runbooks"];
export const retiredSourcePaths = [
	"apps/execution-control/cmd/rag-first-stage-eval-runner",
	"apps/execution-control/internal/rageval/first_stage_runner.go",
	"apps/execution-control/internal/httpapi/rag_eval_adapter.go",
	"packages/eval-langfuse/src/agent-eval-answer-facts.ts",
	"packages/eval-langfuse/src/agent-eval-projection-sources.ts",
	"packages/eval-langfuse/src/context-followup.ts",
	"packages/eval-langfuse/src/score-report.ts",
	"packages/eval-langfuse/fixtures/ops/context_followup_sample_batch.valid.v1.json",
	"packages/eval-langfuse/fixtures/ops/langfuse_context_followup_dataset_manifest.v1.json",
	"packages/eval-langfuse/fixtures/ops/langfuse_context_followup_experiment_manifest.v1.json",
];
export const retiredEvalPolicyPaths = [
	"docs/reference/eval/eval_operations_profile_policy.v1.json",
	"docs/reference/eval/eval_denominator_registry.v1.json",
	"docs/reference/eval/rag_eval_maturity_policy.v1.json",
	"docs/reference/eval/rag_eval_maturity_backlog.v1.json",
	"docs/reference/golden-dataset-case-matrix.md",
];
export const activeSourceTokenScanPaths = [
	"packages/eval-langfuse/src",
	"packages/eval-langfuse/test",
	"apps/app-api/src",
	"apps/app-api/test",
];
export const retiredActiveSourceTokenScanExcludePaths = [
	"packages/eval-langfuse/src/audit/langfuse-eval-audit/constants.ts",
	"packages/eval-langfuse/src/audit/langfuse-eval-audit/self-test.ts",
];
export const retiredActiveSourceTokens = [
	"langfuse_score_report.v1",
	"publishLangfuseScoreReport",
	"validateLangfuseScoreReport",
	"buildScoreReportFromRagasScoreBatch",
	"ragas_diagnostic",
	"ragas-diagnostic-combined-report.v1",
	"agent_rag_answer",
	"agent_multiturn_memory",
	"agent_routing_trajectory",
	"agent_retrieval_planning",
	"coverage-snapshots",
	"diagnostic-badcases",
	"langfuse_eval_coverage.v1",
	"langfuse_ragas_score",
	"langfuse_ragas_score_candidates.v1",
	"eval_coverage_snapshot",
	"eval_diagnostic_badcase_projection",
	"eval_diagnostic_badcases.v1",
	"eval_coverage_snapshot.v1",
	"lastGate",
	"releaseAcceptanceCaseCount",
	"profileArtifactKind",
	"maturityStatus",
	"maturityGaps",
	"eval_profile_gate.v1",
	"eval-release-gate.yml",
	"eval-release-gate-automation",
	"/api/operator/langfuse/eval-backlinks",
	"runLangfuseExperiment",
	"syncLangfuseAnnotationQueue",
	"exportLangfuseReviewResults",
	"langfuse_experiment_manifest",
	"langfuse_review_manifest",
];
export const retiredActiveDocTokens = [
	"eval_coverage_snapshot.v1",
	"coverage-snapshots",
	"diagnostic-badcases",
	"langfuse_eval_coverage.v1",
	"langfuse_ragas_score",
	"langfuse_ragas_score_candidates.v1",
	"eval_coverage_snapshot",
	"eval_diagnostic_badcase_projection",
	"ragasDiagnostic",
	"lastGate",
	"releaseAcceptanceCaseCount",
	"profileArtifactKind",
	"maturityStatus",
	"maturityGaps",
	"eval_profile_gate.v1",
	"eval_operations_profile_policy",
	"eval_denominator_registry",
	"rag_eval_maturity_policy",
	"rag_eval_maturity_backlog",
	"golden-dataset-case-matrix",
];
export const activeEvalDocRegressionTokens = [
	"后续 TS qrels scorer",
	"TS qrels scorer",
	"qrels scorer",
	"future mature benchmark",
	"mature benchmark adapter",
	"eval_coverage_gate_artifacts",
	"live benchmark",
];
export const requiredAppApiEvalMaterializationTokens = [
	"internal eval materialization ingress seam",
	"materialization request",
	"Langfuse/Ragas materialized dataset run",
	"safe trace observation",
];
export const forbiddenAppApiEvalIngressTokens = [
	"live benchmark",
	"deterministic gate",
	"operator publish backflow",
];
export const retiredLangfuseCliTokens = [
	"build-agent-eval-case-results",
	"build-score-report-from-agent-eval",
	"build-score-report-from-rag-retrieval",
	"agent-eval-run-staging",
	"run-ragas-batch",
	"run-context-followup-batch",
	"buildScoreReportFromContextFollowupScoreBatch",
	"runContextFollowupScoreBatch",
	"build-online-answer-results",
	"build-score-report-from-online-answer",
	"build-runtime-profile-results",
	"build-score-report-from-runtime-profile",
	"build-ragas-sample-batch",
	"publish-score-report",
	"run-ragas-scoring",
	"closeout-staging",
	"build-release-evidence",
	"check-release-evidence",
	"run-experiment",
	"sync-annotation-queue",
	"export-review-results",
];
export const requiredLangfuseCliTokens = [
	"ragas-score-traces",
	"ragas-score-dataset",
	"build-rag-dataset-manifest",
	"sync-datasets",
];
export const requiredRagasProjectionTokens = [
	"materialized for Ragas scoring",
	"ragasEvalFieldsFromTrace",
	"retrieved_contexts",
	"reference_context_ids",
];
export const requiredRagasScoreNames = [
	"ragas.faithfulness",
	"ragas.answer_relevancy",
	"ragas.context_precision",
	"ragas.context_recall",
	"ragas.context_precision_without_reference",
	"ragas.id_context_precision",
	"ragas.id_context_recall",
];
export const requiredEvalMapActiveTokens = [
	"## Active Eval Lanes",
	"`ragas-trace`",
	"`ragas-dataset`",
	"## Retired Surfaces",
];
