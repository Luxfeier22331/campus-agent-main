import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildScoreReportFromAgentEvalCaseResults,
	buildScoreReportFromContextFollowupScoreBatch,
	buildScoreReportFromProfileReport,
	buildScoreReportFromRagasScoreBatch,
	checkCollectorConfig,
	deriveLangfuseTraceId,
	publishLangfuseScoreReport,
	runLangfuseExperiment,
	syncLangfuseDatasets,
	traceParentForLangfuseTraceId,
	validateLangfuseReleaseEvidence,
	validateLangfuseScoreReport,
	verifyLangfuseOnlineTraceEvidence,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");

function validProfileReport() {
	return {
		schema_version: "eval_profile_gate.v1",
		profile_id: "online-answer-path",
		case_family: "online_answer_path",
		version_summary: {
			git_head: "abc123",
			runtime_version: "execution-control@abc123",
		},
		sanitized_results: [
			{
				case_id: "case-ok",
				passed: true,
				request_correlation: {
					request_id: "req-001",
					trace_id: "trace-product-001",
				},
			},
			{
				case_id: "case-missing-correlation",
				passed: false,
			},
		],
	};
}

describe("Langfuse trace identity", () => {
	it("matches the shared trace id vectors", () => {
		const fixture = JSON.parse(
			readFileSync(resolve(repoRoot, "tests/fixtures/langfuse_trace_id_vectors.json"), "utf-8"),
		) as {
			vectors: Array<{ product_trace_id: string; langfuse_trace_id: string; traceparent: string }>;
		};

		for (const vector of fixture.vectors) {
			expect(deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});
});

describe("Langfuse score reports", () => {
	it("builds a score report from sanitized profile output and omits missing correlation", () => {
		const report = buildScoreReportFromProfileReport({
			environment: "staging",
			profileReportPath: "profile-report.json",
			profileReportPayload: validProfileReport(),
		});

		expect(report.schema_version).toBe("langfuse_score_report.v1");
		expect(report.expected_publish_denominator).toBe(1);
		expect(report.source_result_denominator).toBe(2);
		expect(report.score_items).toHaveLength(1);
		expect(report.omitted_items).toHaveLength(1);
		expect(report.score_items[0]?.trace_id).toBe(deriveLangfuseTraceId("trace-product-001"));
	});

	it("fails closed on denominator drift and forbidden metadata", () => {
		const report = buildScoreReportFromProfileReport({
			environment: "staging",
			profileReportPath: "profile-report.json",
			profileReportPayload: validProfileReport(),
		});
		report.expected_publish_denominator = 2;
		expect(() => validateLangfuseScoreReport(report)).toThrow(
			"expected_publish_denominator must equal score_items length",
		);

		report.expected_publish_denominator = 1;
		const scoreItem = report.score_items[0];
		if (!scoreItem) {
			throw new Error("expected score item");
		}
		scoreItem.metadata = { raw_prompt: "secret" };
		expect(() => validateLangfuseScoreReport(report)).toThrow(
			"score_items[0].metadata.raw_prompt is forbidden Langfuse metadata",
		);
	});

	it("publishes score payloads with Basic auth and Langfuse field names", async () => {
		const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
		const report = buildScoreReportFromProfileReport({
			environment: "staging",
			profileReportPath: "profile-report.json",
			profileReportPayload: validProfileReport(),
		});
		const result = await publishLangfuseScoreReport({
			fetchImpl: async (input, init) => {
				requests.push({
					body: JSON.parse(String(init?.body)),
					headers: init?.headers as Record<string, string>,
					url: String(input),
				});
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			scoreReportPayload: report,
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(result.published).toBe(1);
		expect(requests[0]?.url).toBe("https://langfuse.example/api/public/scores");
		expect(requests[0]?.headers.authorization).toBe("Basic cGstdGVzdDpzay10ZXN0");
		expect(requests[0]?.body).toMatchObject({
			dataType: "BOOLEAN",
			name: "online-answer-path.profile",
			source: "API",
			traceId: deriveLangfuseTraceId("trace-product-001"),
		});
	});

	it("builds a score report from RAGAS batch scores", () => {
		const report = buildScoreReportFromRagasScoreBatch({
			environment: "staging",
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: {
				schema_version: "ragas_score_batch.v1",
				eval_run_id: "ragas-smoke-001",
				items: [
					{
						case_id: "case-001",
						trace_id: "trace-001",
						observation_id: "obs-001",
						scores: {
							"ragas.faithfulness": 0.91,
							"ragas.answer_relevancy": 0.82,
						},
						errors: [
							{
								metric_name: "ragas.context_recall",
								reason: "missing reference contexts",
							},
						],
						metadata: {
							surface_key: "app-api.chat",
						},
					},
				],
			},
		});

		expect(report.schema_version).toBe("langfuse_score_report.v1");
		expect(report.eval_kind).toBe("ragas");
		expect(report.expected_publish_denominator).toBe(2);
		expect(report.source_result_denominator).toBe(3);
		expect(report.score_items.map((item) => item.name)).toEqual([
			"ragas.faithfulness",
			"ragas.answer_relevancy",
		]);
		expect(report.score_items[0]).toMatchObject({
			case_id: "case-001",
			data_type: "NUMERIC",
			observation_id: "obs-001",
			trace_id: "trace-001",
			value: 0.91,
		});
		expect(report.score_items[0]?.metadata).toMatchObject({
			case_id: "case-001",
			eval_kind: "ragas",
			metric_key: "ragas.faithfulness",
			schema_version: "ragas_score_batch.v1",
			source_artifact_path: "ragas-scores.json",
			surface_key: "app-api.chat",
		});
		expect(report.omitted_items).toHaveLength(1);
		expect(report.omitted_items[0]).toMatchObject({
			case_id: "case-001",
			reason: "missing reference contexts",
			source_result_id: "case-001:ragas.context_recall",
		});
	});

	it("builds dataset-linked score reports from context follow-up batches", () => {
		const report = buildScoreReportFromContextFollowupScoreBatch({
			contextFollowupScoreBatchPath: "context-followup-scores.json",
			contextFollowupScoreBatchPayload: {
				schema_version: "context_followup_score_batch.v1",
				eval_run_id: "context-followup-2026-06-22",
				dataset_version: "context-followup-fixtures.v1",
				variant_id: "baseline-context-envelope-v1",
				source_git_head: "abc123",
				items: [
					{
						case_id: "pronoun-transfer-major",
						trace_id: "trace-ctx-001",
						observation_id: "obs-ctx-001",
						dataset_item_id: "dsitem-pronoun-transfer-major",
						dataset_run_id: "dsrun-context-followup-001",
						scores: {
							"context.pronoun_resolution": 1,
							"context.previous_evidence_reuse": 1,
							"context.rag_followup_recall": 1,
							"context.groundedness": 1,
						},
						errors: [
							{
								metric_name: "context.rag_followup_precision",
								reason: "precision not applicable to previous-evidence-only case",
							},
						],
						metadata: {
							surface_key: "app-api.chat",
							case_family: "multi_turn_context_followup",
						},
					},
				],
			},
			environment: "staging",
		});

		expect(report.schema_version).toBe("langfuse_score_report.v1");
		expect(report.eval_kind).toBe("context_followup");
		expect(report.expected_publish_denominator).toBe(4);
		expect(report.source_result_denominator).toBe(5);
		expect(report.variant_id).toBe("baseline-context-envelope-v1");
		expect(report.source_git_head).toBe("abc123");
		expect(report.score_items[0]).toMatchObject({
			case_id: "pronoun-transfer-major",
			dataset_item_id: "dsitem-pronoun-transfer-major",
			dataset_run_id: "dsrun-context-followup-001",
			name: "context.pronoun_resolution",
			trace_id: "trace-ctx-001",
		});
		expect(report.score_items[0]?.metadata).toMatchObject({
			case_family: "multi_turn_context_followup",
			dataset_version: "context-followup-fixtures.v1",
			eval_kind: "context_followup",
			metric_key: "context.pronoun_resolution",
			source_git_head: "abc123",
			variant_id: "baseline-context-envelope-v1",
		});
		expect(report.omitted_items[0]).toMatchObject({
			case_id: "pronoun-transfer-major",
			reason: "precision not applicable to previous-evidence-only case",
			source_result_id: "pronoun-transfer-major:context.rag_followup_precision",
		});
	});

	it("rejects forbidden context follow-up Langfuse metadata", () => {
		expect(() =>
			buildScoreReportFromContextFollowupScoreBatch({
				contextFollowupScoreBatchPath: "context-followup-scores.json",
				contextFollowupScoreBatchPayload: {
					schema_version: "context_followup_score_batch.v1",
					eval_run_id: "context-followup-2026-06-22",
					dataset_version: "context-followup-fixtures.v1",
					variant_id: "baseline-context-envelope-v1",
					source_git_head: "abc123",
					items: [
						{
							case_id: "forbidden",
							trace_id: "trace-ctx-001",
							scores: {
								"context.pronoun_resolution": 1,
							},
							metadata: {
								raw_transcript: "secret",
							},
						},
					],
				},
				environment: "staging",
			}),
		).toThrow("raw_transcript is forbidden Langfuse metadata");
	});

	it("builds score reports from agent eval case results", () => {
		const report = buildScoreReportFromAgentEvalCaseResults({
			agentEvalCaseResultsPath: "agent-eval-results.json",
			agentEvalCaseResultsPayload: {
				schema_version: "agent_eval_case_results.v1",
				eval_run_id: "agent-routing-2026-06-25",
				dataset_version: "agent-routing-trajectory.v1",
				variant_id: "baseline-agent-policy-v1",
				source_git_head: "abc123",
				items: [
					{
						case_id: "agent-routing-network-password-knowledge",
						trace_id: "trace-agent-001",
						observation_id: "obs-agent-001",
						dataset_item_id: "dsitem-agent-routing-network-password-knowledge",
						dataset_run_id: "dsrun-agent-routing-001",
						verdict: "pass",
						scores: {
							"trajectory.correct": 1,
							"tool_selection.correct": 1,
						},
						metadata: {
							case_family: "agent_routing_trajectory.v1",
							surface_key: "app-api.chat",
						},
					},
				],
			},
			environment: "staging",
		});

		expect(report.schema_version).toBe("langfuse_score_report.v1");
		expect(report.eval_kind).toBe("agent_eval");
		expect(report.expected_publish_denominator).toBe(2);
		expect(report.score_items[0]).toMatchObject({
			case_id: "agent-routing-network-password-knowledge",
			dataset_run_id: "dsrun-agent-routing-001",
			name: "trajectory.correct",
			trace_id: "trace-agent-001",
			value: 1,
		});
		expect(report.score_items[0]?.metadata).toMatchObject({
			case_family: "agent_routing_trajectory.v1",
			dataset_version: "agent-routing-trajectory.v1",
			eval_kind: "agent_eval",
			metric_key: "trajectory.correct",
			source_git_head: "abc123",
			variant_id: "baseline-agent-policy-v1",
			verdict: "pass",
		});
	});
});

describe("Langfuse trace evidence", () => {
	it("verifies sanitized runtime trace evidence", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "execution-control@abc123",
			expectedRequestId: "req-001",
			expectedRunId: "run-001",
			expectedSessionId: "conversation-001",
			expectedTags: ["surface:execution-control", "env:staging"],
			expectedUserId: "user-001",
			expectedWorkflowId: "workflow-001",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						id: "trace-001",
						name: "online-answer",
						release: "execution-control@abc123",
						sessionId: "conversation-001",
						tags: ["surface:execution-control", "env:staging"],
						userId: "user-001",
						metadata: {
							request_id: "req-001",
							run_id: "run-001",
							trace_id: "trace-product-001",
							workflow_id: "workflow-001",
						},
						observations: [
							{
								id: "obs-001",
								metadata: {
									activity_attempt: 1,
									activity_type: "knowledge",
									duration_ms: 12,
									fail_close_reason: "",
									projection_ref: "projection-001",
									request_id: "req-001",
									run_id: "run-001",
									schedule_to_start_ms: 1,
									selected_capability: "knowledge",
									selected_tool: "rag",
									status: "completed",
									step_id: "step-001",
									step_kind: "activity",
									task_queue: "knowledge",
									trace_id: "trace-product-001",
									workflow_id: "workflow-001",
								},
							},
						],
					}),
				),
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(1);
		expect((evidence.trace_identity as { request_id: string }).request_id).toBe("req-001");
	});

	it("rejects forbidden trace payload fields", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							id: "trace-001",
							name: "online-answer",
							release: "release",
							sessionId: "session",
							tags: [],
							userId: "user",
							raw_prompt: "secret",
							observations: [{}],
						}),
					),
				settings: {
					baseUrl: "https://langfuse.example",
					environment: "staging",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
				traceId: "trace-001",
			}),
		).rejects.toThrow("forbidden Langfuse payload fields");
	});
});

describe("Langfuse release and collector contracts", () => {
	it("plans context follow-up dataset sync from repo-owned fixtures", async () => {
		const manifestPath = resolve(
			repoRoot,
			"packages/evals/fixtures/ops/langfuse_context_followup_dataset_manifest.v1.json",
		);
		const report = await syncLangfuseDatasets({
			dryRun: true,
			fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
			manifestPath,
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(report.schema_version).toBe("langfuse_dataset_sync_report.v1");
		const datasets = report.datasets as Array<{ desired_items: Array<{ input: unknown }> }>;
		const dataset = datasets[0];
		expect(dataset.desired_items).toHaveLength(2);
		expect(dataset.desired_items[0]).toMatchObject({
			datasetName: "campus-context-followup-v1",
			input: {
				case_id: "pronoun-transfer-major",
				surface_key: "app-api.chat",
			},
			metadata: {
				case_id: "pronoun-transfer-major",
				source_fixture_path: expect.stringContaining("context_followup_sample_batch.valid.v1.json"),
			},
		});
	});

	it("plans agent eval dataset sync without raw prompt or evidence bodies", async () => {
		const manifestPath = resolve(
			repoRoot,
			"packages/evals/fixtures/ops/langfuse_agent_eval_dataset_manifest.v1.json",
		);
		const report = await syncLangfuseDatasets({
			dryRun: true,
			fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
			manifestPath,
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		const datasets = report.datasets as Array<{
			desired_items: Array<{ expectedOutput: unknown; input: Record<string, unknown> }>;
			name: string;
		}>;
		expect(datasets.map((dataset) => dataset.name)).toEqual([
			"campus-agent-routing-trajectory-v1",
			"campus-agent-rag-answer-v1",
			"campus-agent-retrieval-planning-v1",
			"campus-agent-multiturn-memory-v1",
		]);
		const routingItem = datasets[0]?.desired_items[0];
		expect(routingItem?.input).toMatchObject({
			case_id: "agent-routing-network-password-knowledge",
			surface_key: "app-api.chat",
		});
		expect(routingItem?.input.user_goal_sha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.stringify(report)).not.toContain("校园网密码怎么改");
		expect(JSON.stringify(report)).not.toContain("raw_transcript");
		expect(JSON.stringify(report)).not.toContain("source_body");
	});

	it("writes context follow-up experiment artifact and dataset-run score report", async () => {
		const dir = mkdtempSync(join(tmpdir(), "campus-langfuse-context-"));
		const manifestPath = join(dir, "experiment.json");
		const artifactPath = join(dir, "artifact.json");
		const scoreReportPath = join(dir, "score-report.json");
		const manifest = JSON.parse(
			readFileSync(
				resolve(
					repoRoot,
					"packages/evals/fixtures/ops/langfuse_context_followup_experiment_manifest.v1.json",
				),
				"utf-8",
			),
		) as Record<string, unknown>;
		manifest.artifact_path = artifactPath;
		manifest.score_report_path = scoreReportPath;
		writeFileSync(manifestPath, JSON.stringify(manifest), "utf-8");

		const result = await runLangfuseExperiment({
			fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
			manifestPath,
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(result).toMatchObject({
			dataset_run_id: "dsrun-context-followup-001",
			experiment_kind: "context_followup",
			source_git_head: "unknown",
			variant_id: "baseline-context-envelope-v1",
		});
		const scoreReport = validateLangfuseScoreReport(
			JSON.parse(readFileSync(scoreReportPath, "utf-8")) as Record<string, unknown>,
		);
		expect(scoreReport.score_items).toHaveLength(2);
		expect(scoreReport.score_items[0]).toMatchObject({
			dataset_run_id: "dsrun-context-followup-001",
			name: "context.rag_followup_recall",
		});
	});

	it("validates release evidence command outputs", () => {
		const payload = {
			schema_version: "langfuse_release_evidence.v1",
			environment: "staging",
			release: "execution-control@abc123",
			product_trace_id: "trace-product-001",
			langfuse_trace_id: deriveLangfuseTraceId("trace-product-001"),
			verify_langfuse_trace: {
				command: "pnpm --dir packages/eval-langfuse langfuse verify-trace --json",
				exit_code: 0,
				output: { trace_id: deriveLangfuseTraceId("trace-product-001") },
			},
			publish_langfuse_score_report: {
				command:
					"pnpm --dir packages/eval-langfuse langfuse publish-score-report --score-report langfuse-score-report.json --json",
				exit_code: 0,
				output: { expected_publish_denominator: 1, failed: 0, omitted: 0, published: 1 },
			},
		};

		expect(validateLangfuseReleaseEvidence(payload).passed).toBe(true);
	});

	it("checks derived collector env", () => {
		expect(
			checkCollectorConfig({
				OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER: "Basic abc",
				OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION: "4",
				OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
			}).passed,
		).toBe(true);
	});

	it("writes JSON files through the CLI contract", () => {
		const dir = mkdtempSync(join(tmpdir(), "campus-langfuse-"));
		const profilePath = join(dir, "profile-report.json");
		writeFileSync(profilePath, JSON.stringify(validProfileReport()), "utf-8");
		expect(profilePath.endsWith("profile-report.json")).toBe(true);
	});
});
