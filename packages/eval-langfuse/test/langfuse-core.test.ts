import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildScoreReportFromProfileReport,
	checkCollectorConfig,
	deriveLangfuseTraceId,
	publishLangfuseScoreReport,
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
