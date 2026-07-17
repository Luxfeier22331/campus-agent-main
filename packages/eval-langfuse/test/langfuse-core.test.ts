import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildEvalDatasetManifest,
	buildLangfuseDatasetItems,
	buildLangfuseScoresFromRagasScoreBatch,
	checkCollectorConfig,
	deriveLangfuseTraceId,
	publishLangfuseScores,
	runRagasDatasetScoring,
	runRagasTraceScoring,
	traceParentForLangfuseTraceId,
	validateLangfuseScorePublishPlan,
	verifyLangfuseOnlineTraceEvidence,
} from "../src/index";

const repoRoot = resolve(import.meta.dirname, "../../..");

afterEach(() => {
	vi.doUnmock("node:child_process");
	vi.restoreAllMocks();
});

function validRagasScoreBatch() {
	return {
		schema_version: "ragas_score_batch.v1",
		eval_run_id: "ragas-smoke-001",
		items: [
			{
				case_id: "case-ok",
				trace_id: "trace-product-001",
				observation_id: "obs-001",
				scores: {
					"ragas.faithfulness": 0.91,
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
	};
}

const TEST_LANGFUSE_SETTINGS = {
	baseUrl: "https://langfuse.example",
	environment: "staging",
	publicKey: "pk-test",
	secretKey: "sk-test",
} as const;

function repoObservation(input: { id?: string; metadata?: Record<string, unknown> } = {}) {
	return {
		id: input.id ?? "obs-repo-001",
		metadata: {
			activity_attempt: 1,
			activity_type: "agent.primary",
			duration_ms: 12,
			fail_close_reason: "",
			projection_ref: "projection-001",
			request_id: "req-001",
			run_id: "run-001",
			schedule_to_start_ms: 1,
			selected_tool: "",
			status: "completed",
			step_id: "agent.primary",
			step_kind: "agent",
			task_queue: "agent",
			trace_id: "trace-product-001",
			workflow_id: "workflow-001",
			...(input.metadata ?? {}),
		},
	};
}

function onlineTracePayload(
	overrides: {
		metadata?: Record<string, unknown>;
		observations?: unknown[];
		release?: string;
		sessionId?: string;
		tags?: string[];
		userId?: string;
	} = {},
) {
	return {
		id: "trace-001",
		name: "online-answer",
		release: overrides.release ?? "release",
		sessionId: overrides.sessionId ?? "session",
		tags: overrides.tags ?? [],
		userId: overrides.userId ?? "user",
		metadata: {
			request_id: "req-001",
			run_id: "run-001",
			trace_id: "trace-product-001",
			workflow_id: "workflow-001",
			...overrides.metadata,
		},
		observations: overrides.observations ?? [repoObservation()],
	};
}

function traceFetch(payload: unknown) {
	return async () => new Response(JSON.stringify(payload));
}

describe("Langfuse trace identity", () => {
	it("matches the shared trace id vectors", () => {
		const fixture = JSON.parse(
			readFileSync(
				resolve(repoRoot, "packages/eval-langfuse/test/fixtures/langfuse_trace_id_vectors.json"),
				"utf-8",
			),
		) as {
			vectors: Array<{ product_trace_id: string; langfuse_trace_id: string; traceparent: string }>;
		};

		for (const vector of fixture.vectors) {
			expect(deriveLangfuseTraceId(vector.product_trace_id)).toBe(vector.langfuse_trace_id);
			expect(traceParentForLangfuseTraceId(vector.langfuse_trace_id)).toBe(vector.traceparent);
		}
	});
});

describe("Langfuse score publisher", () => {
	it("builds Langfuse score items from RAGAS scores and preserves omissions", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});

		expect(plan.scoreItems).toHaveLength(1);
		expect(plan.omittedItems).toHaveLength(1);
		expect(plan.sourceResultDenominator).toBe(2);
		expect(plan.scoreItems[0]).toMatchObject({
			observation_id: "obs-001",
			trace_id: null,
		});
		expect(plan.omittedItems[0]).toMatchObject({
			case_id: "case-ok",
			reason: "missing reference contexts",
		});
	});

	it("fails closed on denominator drift and forbidden metadata", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		plan.sourceResultDenominator = 3;
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"sourceResultDenominator must equal scoreItems plus omittedItems length",
		);

		plan.sourceResultDenominator = 2;
		const scoreItem = plan.scoreItems[0];
		if (!scoreItem) {
			throw new Error("expected score item");
		}
		scoreItem.metadata = { raw_prompt: "secret" };
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0].metadata.raw_prompt is forbidden Langfuse metadata",
		);
	});

	it("requires exactly one score target", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		const scoreItem = plan.scoreItems[0];
		if (!scoreItem) {
			throw new Error("expected score item");
		}

		scoreItem.trace_id = "trace-product-001";
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0] must carry exactly one of trace_id or observation_id",
		);

		scoreItem.trace_id = null;
		scoreItem.observation_id = null;
		expect(() => validateLangfuseScorePublishPlan(plan)).toThrow(
			"scoreItems[0] must carry exactly one of trace_id or observation_id",
		);
	});

	it("publishes score payloads with Basic auth and Langfuse field names", async () => {
		const requests: Array<{ body: unknown; headers: Record<string, string>; url: string }> = [];
		const plan = buildLangfuseScoresFromRagasScoreBatch({
			ragasScoreBatchPath: "ragas-scores.json",
			ragasScoreBatchPayload: validRagasScoreBatch(),
		});
		const result = await publishLangfuseScores({
			evalRunId: plan.evalRunId,
			fetchImpl: async (input, init) => {
				requests.push({
					body: JSON.parse(String(init?.body)),
					headers: init?.headers as Record<string, string>,
					url: String(input),
				});
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			omittedItems: plan.omittedItems,
			scoreItems: plan.scoreItems,
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			sourceResultDenominator: plan.sourceResultDenominator,
		});

		expect(result.published).toBe(1);
		expect(requests[0]?.url).toBe("https://langfuse.example/api/public/scores");
		expect(requests[0]?.headers.authorization).toBe("Basic cGstdGVzdDpzay10ZXN0");
		expect(requests[0]?.body).toMatchObject({
			dataType: "NUMERIC",
			name: "ragas.faithfulness",
			observationId: "obs-001",
			source: "API",
		});
		expect(requests[0]?.body).not.toHaveProperty("traceId");
		expect(requests[0]?.body).not.toHaveProperty("datasetItemId");
		expect(requests[0]?.body).not.toHaveProperty("datasetRunId");
	});

	it("builds score items from RAGAS scores", () => {
		const plan = buildLangfuseScoresFromRagasScoreBatch({
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

		expect(plan.scoreItems).toHaveLength(2);
		expect(plan.sourceResultDenominator).toBe(3);
		expect(plan.scoreItems.map((item) => item.name)).toEqual([
			"ragas.faithfulness",
			"ragas.answer_relevancy",
		]);
		expect(plan.scoreItems[0]).toMatchObject({
			case_id: "case-001",
			data_type: "NUMERIC",
			observation_id: "obs-001",
			trace_id: null,
			value: 0.91,
		});
		expect(plan.scoreItems[0]?.metadata).toMatchObject({
			case_id: "case-001",
			eval_kind: "ragas",
			metric_key: "ragas.faithfulness",
			schema_version: "ragas_score_batch.v1",
			source_artifact_path: "ragas-scores.json",
			surface_key: "app-api.chat",
		});
		expect(plan.omittedItems).toHaveLength(1);
		expect(plan.omittedItems[0]).toMatchObject({
			case_id: "case-001",
			reason: "missing reference contexts",
			source_result_id: "case-001:ragas.context_recall",
		});
	});
});

describe("eval dataset manifest builder", () => {
	it("projects canonical agent and RAG cases into Langfuse dataset manifests", () => {
		const manifest = buildEvalDatasetManifest({
			assetRoot: resolve(repoRoot, "packages/eval-langfuse/assets"),
			sourceGitHead: "test-head",
		});

		expect(manifest).toMatchObject({
			schema_version: "langfuse_dataset_manifest.v2",
			source_git_head: "test-head",
		});
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/student_rules",
		);
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/institutional_rules",
		);
		expect((manifest.datasets as Array<{ name: string }>).map((dataset) => dataset.name)).toContain(
			"campus/rag/cross_target",
		);
		expect(manifest.datasets).toContainEqual(
			expect.objectContaining({
				kind: "agent_tool_eval",
				name: "campus/agent/routing",
				surface_key: "app-api.chat",
			}),
		);
		expect(JSON.stringify(manifest)).not.toContain("fixture_");
	});

	it("builds agent routing items with per-case tool argument modes", () => {
		const assetPath = resolve(
			repoRoot,
			"packages/eval-langfuse/assets/datasets/agent/routing/cases.v1.json",
		);
		const items = buildLangfuseDatasetItems({
			dataset: {
				collection: "routing",
				asset_path: assetPath,
				kind: "agent_tool_eval",
				name: "campus/agent/routing",
				slug: "agent-routing",
				surface_key: "app-api.chat",
			},
			assetHash: "asset-hash",
			assetPath,
			sourceGitHead: "test-head",
		});

		expect(items.find((item) => metadataCaseId(item) === "routing-direct-greeting")).toMatchObject({
			expectedOutput: { reference_tool_calls: [] },
			metadata: { argument_mode: "name_only" },
		});
		expect(
			items.find((item) => metadataCaseId(item) === "routing-knowledge-student-rules"),
		).toMatchObject({
			expectedOutput: {
				reference_tool_calls: [
					{ args: {}, name: "knowledge_query" },
					{
						args: { include_history: false, target: "student_rules" },
						name: "knowledge_search",
					},
				],
			},
			input: { query: "学生申请缓考需要满足什么条件？" },
			metadata: { argument_mode: "eval_safe_args" },
		});
	});

	it("builds one Langfuse item with answer and retrieval truth", () => {
		const assetPath = resolve(
			repoRoot,
			"packages/eval-langfuse/assets/datasets/rag/student_rules/cases.v1.json",
		);
		const items = buildLangfuseDatasetItems({
			dataset: {
				collection: "student_rules",
				asset_path: assetPath,
				kind: "rag_eval",
				name: "campus/rag/student_rules",
				slug: "rag-student-rules",
				surface_key: "rag/student_rules",
			},
			assetHash: "asset-hash",
			assetPath,
			sourceGitHead: "test-head",
		});
		const item = items.find(
			(candidate) => metadataCaseId(candidate) === "student-rules-medical-version",
		);
		const historyItem = items.find(
			(candidate) => metadataCaseId(candidate) === "student-rules-conversation-follow-up",
		);

		expect(item).toMatchObject({
			datasetName: "campus/rag/student_rules",
			expectedOutput: {
				expected_outcome: "answer",
				expected_targets: ["student_rules"],
				metric_applicability: {
					context_recall: true,
				},
				reference_context_ids: ["handbook:synthetic-medical-policy"],
				reference_tool_calls: [
					{ args: {}, name: "knowledge_query" },
					{
						args: { include_history: false, target: "student_rules" },
						name: "knowledge_search",
					},
				],
			},
			input: {
				case_id: "student-rules-medical-version",
				question: "示例学生医疗报销按什么办法办理？",
				surface_key: "rag/student_rules",
				user_input: "示例学生医疗报销按什么办法办理？",
			},
			metadata: {
				argument_mode: "eval_safe_args",
				case_id: "student-rules-medical-version",
				asset_hash: "asset-hash",
				source_git_head: "test-head",
				source_asset_path: assetPath,
			},
		});
		expect(JSON.stringify(item)).not.toContain("fixture_");
		expect(item?.expectedOutput).toHaveProperty("reference");
		expect(historyItem?.input).toMatchObject({
			setup_turns: ["请帮我查一下示例学位授予规定。"],
		});
	});
});

function metadataCaseId(item: { metadata?: unknown }): string | null {
	const metadata = item.metadata;
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return null;
	}
	const value = (metadata as Record<string, unknown>).case_id;
	return typeof value === "string" ? value : null;
}

describe("Ragas Langfuse official pipeline", () => {
	it("scores Langfuse traces through Ragas and writes Langfuse scores", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const result = await runRagasTraceScoring({
			environment: "staging",
			fetchImpl: async (input, init) => {
				const url = String(input);
				if (init?.body) {
					requests.push({ body: JSON.parse(String(init.body)), url });
				}
				if (url.includes("/api/public/traces")) {
					return new Response(
						JSON.stringify({
							data: [
								{
									id: "trace-001",
									metadata: {
										"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
										"eval.question": "图书馆开放时间是什么？",
										"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
										"eval.surface_key": "app-api.chat",
									},
								},
							],
							meta: { totalPages: 1 },
						}),
					);
				}
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			runPythonRagasScoreBatch: ({ outputPath }) => {
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: "ragas-trace-run",
						items: [
							{
								case_id: "trace-001",
								errors: [],
								metadata: { surface_key: "app-api.chat" },
								observation_id: null,
								scores: { "ragas.faithfulness": 0.9 },
								trace_id: "trace-001",
							},
						],
						schema_version: "ragas_score_batch.v1",
					}),
					"utf-8",
				);
			},
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
			validateOnly: false,
		});

		expect(result.source_kind).toBe("langfuse_trace");
		expect(result.published).toBe(1);
		expect(requests[0]).toMatchObject({
			body: {
				metadata: {
					source_kind: "langfuse_trace",
				},
				name: "ragas.faithfulness",
				traceId: "trace-001",
			},
			url: "https://langfuse.example/api/public/scores",
		});
		const scoreRequestBody = requests[0]?.body as
			| { metadata?: Record<string, unknown> }
			| undefined;
		expect(scoreRequestBody?.metadata).not.toHaveProperty("source_artifact_path");
	});

	it("scores Langfuse dataset items and preserves dataset score identity", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const writtenSamples: unknown[] = [];
		const result = await runRagasDatasetScoring({
			datasetName: "campus-agent-golden",
			environment: "staging",
			fetchImpl: async (input, init) => {
				const url = String(input);
				if (init?.body) {
					requests.push({ body: JSON.parse(String(init.body)), url });
				}
				if (url.includes("/api/public/datasets/campus-agent-golden")) {
					return new Response(
						JSON.stringify({
							items: [
								{
									expectedOutput: {
										reference: "图书馆开放时间为 08:00-22:00。",
										reference_context_ids: ["doc:library-hours"],
										reference_contexts: ["图书馆开放时间为 08:00-22:00。"],
									},
									id: "dataset-item-001",
									input: {
										question: "图书馆开放时间是什么？",
									},
									metadata: {
										case_id: "library-hours",
										dataset_run_id: "dataset-run-001",
										observation_id: "obs-001",
										trace_id: "trace-001",
									},
								},
							],
						}),
					);
				}
				if (url.includes("/api/public/traces/trace-001")) {
					return new Response(
						JSON.stringify({
							id: "trace-001",
							observations: [
								{
									id: "obs-001",
									metadata: {
										"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
										"eval.retrieved_context_ids": ["doc:library-hours"],
										"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
									},
								},
							],
						}),
					);
				}
				return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
			},
			runPythonRagasScoreBatch: ({ inputPath, outputPath }) => {
				writtenSamples.push(JSON.parse(readFileSync(inputPath, "utf-8")));
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: "ragas-dataset-run",
						items: [
							{
								case_id: "library-hours",
								dataset_item_id: "dataset-item-001",
								dataset_run_id: "dataset-run-001",
								errors: [],
								metadata: {},
								scores: { "ragas.context_precision": 1 },
								trace_id: "trace-001",
							},
						],
						schema_version: "ragas_score_batch.v1",
					}),
					"utf-8",
				);
			},
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "staging",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(result.source_kind).toBe("langfuse_dataset");
		expect(requests[0]?.body).toMatchObject({
			metadata: {
				source_kind: "langfuse_dataset",
			},
			name: "ragas.context_precision",
			traceId: "trace-001",
		});
		expect(requests[0]?.body).not.toHaveProperty("datasetItemId");
		expect(requests[0]?.body).not.toHaveProperty("datasetRunId");
		expect(writtenSamples[0]).toMatchObject({
			items: [
				{
					answer: "图书馆开放时间为 08:00 到 22:00。",
					contexts: ["图书馆开放时间为 08:00-22:00。"],
					observation_id: "obs-001",
					reference_context_ids: ["doc:library-hours"],
					retrieved_context_ids: ["doc:library-hours"],
				},
			],
		});
	});

	it("fails closed when a dataset item is not materialized into Ragas inputs", async () => {
		await expect(
			runRagasDatasetScoring({
				datasetName: "campus/rag/student_rules",
				environment: "staging",
				fetchImpl: async () =>
					new Response(
						JSON.stringify({
							items: [
								{
									expectedOutput: {
										reference_context_ids: ["doc:student-rules"],
									},
									id: "dataset-item-unmaterialized",
									input: {
										case_id: "synthetic-policy-title-medical",
										question: "示例学生医疗报销管理办法",
									},
									metadata: {
										case_id: "synthetic-policy-title-medical",
									},
								},
							],
						}),
					),
				runPythonRagasScoreBatch: () => {
					throw new Error("Ragas runner must not be invoked for unmaterialized items");
				},
				settings: {
					baseUrl: "https://langfuse.example",
					environment: "staging",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
			}),
		).rejects.toThrow(
			"synthetic-policy-title-medical is not materialized for Ragas scoring; missing trace_id, answer, retrieved_contexts",
		);
	});

	it("fails closed when a materialized dataset item points to a missing observation", async () => {
		await expect(
			runRagasDatasetScoring({
				datasetName: "campus-agent-golden",
				environment: "staging",
				fetchImpl: async (input) => {
					const url = String(input);
					if (url.includes("/api/public/datasets/campus-agent-golden")) {
						return new Response(
							JSON.stringify({
								items: [
									{
										id: "dataset-item-missing-observation",
										input: {
											question: "图书馆开放时间是什么？",
										},
										metadata: {
											case_id: "library-hours",
											observation_id: "obs-missing",
											trace_id: "trace-001",
										},
									},
								],
							}),
						);
					}
					if (url.includes("/api/public/traces/trace-001")) {
						return new Response(
							JSON.stringify({
								id: "trace-001",
								observations: [
									{
										id: "obs-other",
										metadata: {
											"eval.answer": "图书馆开放时间为 08:00 到 22:00。",
											"eval.retrieved_contexts": ["图书馆开放时间为 08:00-22:00。"],
										},
									},
								],
							}),
						);
					}
					return new Response(JSON.stringify({ id: "score-001" }), { status: 200 });
				},
				runPythonRagasScoreBatch: () => {
					throw new Error("Ragas runner must not be invoked when observation is missing");
				},
				settings: {
					baseUrl: "https://langfuse.example",
					environment: "staging",
					publicKey: "pk-test",
					secretKey: "sk-test",
				},
			}),
		).rejects.toThrow(
			"trace-001.obs-missing is not materialized for Ragas scoring; missing observation_id.",
		);
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
			fetchImpl: traceFetch(
				onlineTracePayload({
					observations: [
						repoObservation({
							id: "obs-001",
							metadata: {
								activity_type: "knowledge",
								selected_tool: "knowledge_query",
								step_id: "step-001",
								step_kind: "activity",
								task_queue: "knowledge",
							},
						}),
					],
					release: "execution-control@abc123",
					sessionId: "conversation-001",
					tags: ["surface:execution-control", "env:staging"],
					userId: "user-001",
				}),
			),
			settings: TEST_LANGFUSE_SETTINGS,
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(1);
		expect(evidence.forbidden_check_passed).toBe(true);
		expect((evidence.trace_identity as { request_id: string }).request_id).toBe("req-001");
	});

	it("allows controlled LLM debug observations to carry raw model IO fields", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "release",
			expectedRequestId: "req-001",
			expectedRunId: "run-001",
			expectedSessionId: "session",
			expectedTags: [],
			expectedUserId: "user",
			expectedWorkflowId: "workflow-001",
			fetchImpl: traceFetch(
				onlineTracePayload({
					observations: [
						repoObservation(),
						{
							id: "obs-llm-debug-001",
							metadata: {
								provider_raw_response: { id: "resp_001" },
								raw_answer: "debug-only answer body",
								raw_prompt: "debug-only prompt body",
							},
							name: "openai.model_call",
						},
					],
				}),
			),
			settings: TEST_LANGFUSE_SETTINGS,
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(1);
		expect(evidence.non_repo_observation_count).toBe(1);
	});

	it("allows model IO fields on repo-owned observations", async () => {
		const evidence = await verifyLangfuseOnlineTraceEvidence({
			expectedRelease: "release",
			expectedSessionId: "session",
			expectedTags: [],
			expectedUserId: "user",
			fetchImpl: traceFetch(
				onlineTracePayload({
					observations: [
						repoObservation({
							metadata: { raw_prompt: "repo projection must not carry this" },
						}),
					],
				}),
			),
			settings: TEST_LANGFUSE_SETTINGS,
			traceId: "trace-001",
		});

		expect(evidence.repo_owned_observation_count).toBe(1);
	});

	it("rejects secrets from all trace observations", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: traceFetch(
					onlineTracePayload({
						observations: [
							repoObservation(),
							{
								id: "obs-llm-debug-001",
								metadata: {
									authorization: "Bearer secret",
									raw_prompt: "debug prompt can exist, but auth cannot",
								},
							},
						],
					}),
				),
				settings: TEST_LANGFUSE_SETTINGS,
				traceId: "trace-001",
			}),
		).rejects.toThrow("forbidden Langfuse payload fields: authorization");
	});

	it("normalizes camelCase credential field names", async () => {
		await expect(
			verifyLangfuseOnlineTraceEvidence({
				expectedRelease: "release",
				expectedSessionId: "session",
				expectedTags: [],
				expectedUserId: "user",
				fetchImpl: traceFetch(
					onlineTracePayload({
						observations: [
							repoObservation(),
							{
								id: "obs-llm-debug-001",
								metadata: { clientSecret: "secret" },
							},
						],
					}),
				),
				settings: TEST_LANGFUSE_SETTINGS,
				traceId: "trace-001",
			}),
		).rejects.toThrow("forbidden Langfuse payload fields: clientSecret");
	});
});

describe("Langfuse collector contracts", () => {
	it("checks derived collector env", () => {
		expect(
			checkCollectorConfig({
				OTEL_COLLECTOR_AXIOM_LOGS_DATASET: "campus-agent-staging-logs",
				OTEL_COLLECTOR_AXIOM_LOGS_TOKEN: "axiom-logs",
				OTEL_COLLECTOR_AXIOM_METRICS_DATASET: "campus-agent-staging-metrics",
				OTEL_COLLECTOR_AXIOM_METRICS_TOKEN: "axiom-metrics",
				OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT: "https://us-east-1.aws.edge.axiom.co",
				OTEL_COLLECTOR_AXIOM_TRACES_DATASET: "campus-agent-staging-traces",
				OTEL_COLLECTOR_AXIOM_TRACES_TOKEN: "axiom-traces",
				OTEL_COLLECTOR_LANGFUSE_HINDSIGHT_AUTH_HEADER: "Basic hindsight",
				OTEL_COLLECTOR_LANGFUSE_HINDSIGHT_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
				OTEL_COLLECTOR_LANGFUSE_RUNTIME_AUTH_HEADER: "Basic runtime",
				OTEL_COLLECTOR_LANGFUSE_RUNTIME_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
			}).passed,
		).toBe(true);
	});

	it("requires Axiom metrics dataset for full fanout", () => {
		const result = checkCollectorConfig({
			OTEL_COLLECTOR_AXIOM_LOGS_DATASET: "campus-agent-staging-logs",
			OTEL_COLLECTOR_AXIOM_LOGS_TOKEN: "axiom-logs",
			OTEL_COLLECTOR_AXIOM_METRICS_TOKEN: "axiom-metrics",
			OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT: "https://us-east-1.aws.edge.axiom.co",
			OTEL_COLLECTOR_AXIOM_TRACES_DATASET: "campus-agent-staging-traces",
			OTEL_COLLECTOR_AXIOM_TRACES_TOKEN: "axiom-traces",
			OTEL_COLLECTOR_LANGFUSE_HINDSIGHT_AUTH_HEADER: "Basic hindsight",
			OTEL_COLLECTOR_LANGFUSE_HINDSIGHT_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
			OTEL_COLLECTOR_LANGFUSE_RUNTIME_AUTH_HEADER: "Basic runtime",
			OTEL_COLLECTOR_LANGFUSE_RUNTIME_OTLP_ENDPOINT: "https://langfuse.example/api/public/otel",
		});

		expect(result.passed).toBe(false);
		expect(result.errors).toContain("OTEL_COLLECTOR_AXIOM_METRICS_DATASET is required");
	});
});
