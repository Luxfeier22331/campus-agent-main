import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	buildLangfuseScoresFromRagasAgentScoreBatch,
	deriveLangfuseTraceId,
	runAgentToolEval,
	validateAgentToolEvalDataset,
} from "../src/index";
import type { JsonObject } from "../src/shared";

function sse(event: string, data: JsonObject): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(payload), {
		headers: { "content-type": "application/json" },
		status: init?.status ?? 200,
	});
}

function runStepsResponse(toolTrajectory: JsonObject, rag: JsonObject = {}): Response {
	return jsonResponse({
		agentRuntimeEvalProjection: {
			planning: {},
			rag,
			run: {
				run_id: toolTrajectory.run_id,
				trace_id: toolTrajectory.trace_id,
			},
			schema_version: "agent_runtime_eval_projection.v2",
			tool_trajectory: toolTrajectory,
		},
		attempts: [],
		results: [],
		steps: [],
	});
}

describe("agent tool eval dataset", () => {
	it("validates Langfuse-style agent tool selection dataset items", () => {
		const result = validateAgentToolEvalDataset({
			items: [
				{
					expectedOutput: {
						reference_tool_calls: [{ args: {}, name: "transport_schedule_lookup" }],
					},
					id: "dataset-item-001",
					input: {
						query: "校车现在能到海淀校区吗？",
					},
					metadata: {
						argument_mode: "name_only",
						case_family: "transport",
						case_id: "transport-route",
					},
				},
				{
					expectedOutput: {
						reference_tool_calls: [],
					},
					id: "dataset-item-002",
					input: {
						query: "你好",
					},
					metadata: {
						argument_mode: "name_only",
						case_family: "direct",
						case_id: "direct-greeting",
					},
				},
			],
			name: "campus/agent/tool-selection",
		});

		expect(result).toMatchObject({
			case_count: 2,
			schema_version: "agent_tool_eval_dataset.v1",
			tool_counts: {
				direct_answer: 1,
				transport_schedule_lookup: 1,
			},
		});
	});

	it("rejects eval_safe_args cases without reference args", () => {
		expect(() =>
			validateAgentToolEvalDataset({
				items: [
					{
						expectedOutput: {
							reference_tool_calls: [{ args: {}, name: "transport_schedule_lookup" }],
						},
						id: "dataset-item-001",
						input: {
							query: "校车现在能到海淀校区吗？",
						},
						metadata: {
							argument_mode: "eval_safe_args",
							case_id: "transport-route",
						},
					},
				],
			}),
		).toThrow("eval_safe_args requires non-empty reference tool args");
	});
});

describe("Ragas agent Langfuse score adapter", () => {
	it("builds Langfuse score items from Ragas agent scores", () => {
		const plan = buildLangfuseScoresFromRagasAgentScoreBatch({
			ragasAgentScoreBatchPath: "ragas-agent-scores.json",
			ragasAgentScoreBatchPayload: {
				eval_run_id: "agent-eval-001",
				items: [
					{
						case_id: "transport-route",
						dataset_item_id: "dataset-item-001",
						dataset_run_id: "dataset-run-001",
						errors: [],
						metadata: {
							argument_mode: "name_only",
							surface_key: "app-api.chat",
						},
						observation_id: null,
						scores: {
							"ragas.tool_call_accuracy.name_only": 1,
							"ragas.tool_call_f1.name_only": 1,
						},
						trace_id: "trace-001",
					},
				],
				schema_version: "ragas_agent_score_batch.v1",
			},
			sourceKind: "langfuse_dataset",
		});

		expect(plan.scoreItems).toHaveLength(2);
		expect(plan.omittedItems).toHaveLength(0);
		expect(plan.scoreItems[0]).toMatchObject({
			case_id: "transport-route",
			data_type: "NUMERIC",
			dataset_item_id: "dataset-item-001",
			dataset_run_id: "dataset-run-001",
			name: "ragas.tool_call_accuracy.name_only",
			trace_id: "trace-001",
			value: 1,
		});
		expect(plan.scoreItems[0]?.metadata).toMatchObject({
			argument_mode: "name_only",
			case_id: "transport-route",
			eval_kind: "ragas_agent",
			metric_key: "ragas.tool_call_accuracy.name_only",
			schema_version: "ragas_agent_score_batch.v1",
			source_kind: "langfuse_dataset",
			surface_key: "app-api.chat",
		});
	});
});

describe("agent tool eval runner", () => {
	it("links a real product trace and publishes agent, RAG, and deterministic scores", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const writtenAgentSamples: JsonObject[] = [];
		const writtenRagSamples: JsonObject[] = [];
		const productTraceId = "trace-product-001";
		const langfuseTraceId = deriveLangfuseTraceId(productTraceId);
		let chatRequestCount = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/api/public/datasets/campus%2Fagent%2Ftool-selection")) {
				return jsonResponse({
					items: [
						{
							expectedOutput: {
								expected_outcome: "answer",
								forbidden_context_ids: ["handbook:wrong-policy"],
								reference: "应依据示例学位授予规定第十条回答。",
								reference_context_ids: ["handbook:degree-policy"],
								reference_tool_calls: [
									{
										args: {},
										name: "knowledge_query",
									},
									{
										args: { include_history: false, target: "student_rules" },
										name: "knowledge_search",
									},
								],
							},
							id: "dataset-item-001",
							input: {
								query: "那第十条呢？",
								setup_turns: ["请帮我查一下示例学位授予规定。"],
							},
							metadata: {
								argument_mode: "eval_safe_args",
								case_family: "conversation_follow_up",
								case_id: "student-rules-conversation-follow-up",
								surface_key: "rag/student_rules",
							},
						},
					],
				});
			}
			if (url.endsWith("/api/chat/requests/stream")) {
				const body = init?.body ? (JSON.parse(String(init.body)) as JsonObject) : {};
				requests.push({
					body,
					url,
				});
				const isSetupTurn = chatRequestCount === 0;
				chatRequestCount += 1;
				const requestId = isSetupTurn ? "req-setup" : "req-001";
				const runId = isSetupTurn ? "run-setup" : "run-001";
				const traceId = isSetupTurn ? "trace-setup" : productTraceId;
				return new Response(
					sse("request.accepted", {
						requestId,
						runId,
						status: "accepted",
						traceId,
					}) +
						sse("request.completed", {
							answer: {
								conversation: {
									id: "conv-001",
									messages: [],
								},
								result: {
									kind: "answer",
									requestId,
									text: isSetupTurn ? "我会查看该规定。" : "第十条规定了学位授予条件。",
									traceId,
								},
							},
							requestId,
							status: "completed",
							traceId,
						}),
					{
						headers: { "content-type": "text/event-stream" },
						status: 200,
					},
				);
			}
			if (url.endsWith("/api/chat/runs/run-001/steps")) {
				return runStepsResponse(
					{
						available_tools: ["knowledge_query", "transport_schedule_lookup"],
						conversation_id: "conv-001",
						decision_kind: "tool_call",
						internal_tool_calls: [
							{
								eval_safe_args: { include_history: false, target: "student_rules" },
								result_kind: "knowledge_search_result",
								search_ordinal: 1,
								status: "completed",
								tool_call_id: "search-001",
								tool_name: "knowledge_search",
							},
						],
						request_id: "req-001",
						run_id: "run-001",
						schema_version: "tool_trajectory.v2",
						selected_tool: "knowledge_query",
						surface: "campus-web",
						tool_calls: [
							{
								result_kind: "agent_handoff",
								status: "completed",
								tool_call_id: "call-001",
								tool_name: "knowledge_query",
							},
						],
						trace_id: productTraceId,
					},
					{
						answer: "第十条规定了学位授予条件。",
						retrieved_context_ids: ["handbook:degree-policy"],
						retrieved_contexts: ["第十条规定申请人应满足学位授予条件。"],
					},
				);
			}
			if (url.endsWith("/api/public/dataset-run-items")) {
				requests.push({
					body: init?.body ? JSON.parse(String(init.body)) : null,
					url,
				});
				return jsonResponse({
					createdAt: "2026-07-12T00:00:00Z",
					datasetItemId: "dataset-item-001",
					datasetRunId: "dataset-run-official",
					datasetRunName: "agent-eval-run",
					id: "dataset-run-item-001",
					observationId: null,
					traceId: langfuseTraceId,
					updatedAt: "2026-07-12T00:00:00Z",
				});
			}
			if (url.endsWith("/api/public/scores")) {
				requests.push({
					body: init?.body ? JSON.parse(String(init.body)) : null,
					url,
				});
				return jsonResponse({ id: "score-001" });
			}
			throw new Error(`unexpected fetch: ${url}`);
		};

		const result = await runAgentToolEval({
			appApiBaseUrl: "https://campus-staging.example",
			cookieHeader: "session=abc",
			datasetName: "campus/agent/tool-selection",
			environment: "test",
			fetchImpl,
			runPythonRagasAgentScoreBatch: ({ inputPath, outputPath }) => {
				const samples = JSON.parse(readFileSync(inputPath, "utf-8")) as JsonObject;
				writtenAgentSamples.push(samples);
				const sample = (samples.items as JsonObject[])[0] as JsonObject;
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: samples.eval_run_id,
						items: [
							{
								case_id: sample.case_id,
								dataset_item_id: sample.dataset_item_id,
								dataset_run_id: sample.dataset_run_id,
								errors: [],
								metadata: {
									argument_mode: "eval_safe_args",
									surface_key: "app-api.chat",
								},
								observation_id: null,
								scores: {
									"ragas.tool_call_accuracy.args": 1,
								},
								trace_id: sample.trace_id,
							},
						],
						schema_version: "ragas_agent_score_batch.v1",
					}),
					"utf-8",
				);
			},
			runPythonRagasScoreBatch: ({ inputPath, outputPath }) => {
				const samples = JSON.parse(readFileSync(inputPath, "utf-8")) as JsonObject;
				writtenRagSamples.push(samples);
				const sample = (samples.items as JsonObject[])[0] as JsonObject;
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: samples.eval_run_id,
						items: [
							{
								case_id: sample.case_id,
								dataset_item_id: sample.dataset_item_id,
								dataset_run_id: sample.dataset_run_id,
								errors: [],
								metadata: { surface_key: "rag/student_rules" },
								observation_id: null,
								scores: { "ragas.faithfulness": 1 },
								trace_id: sample.trace_id,
							},
						],
						schema_version: "ragas_score_batch.v1",
					}),
					"utf-8",
				);
			},
			settings: {
				baseUrl: "https://langfuse.example",
				environment: "test",
				publicKey: "pk-test",
				secretKey: "sk-test",
			},
		});

		expect(writtenAgentSamples).toHaveLength(1);
		expect(writtenAgentSamples[0]).toMatchObject({
			items: [
				{
					argument_mode: "eval_safe_args",
					case_id: "student-rules-conversation-follow-up",
					dataset_item_id: "dataset-item-001",
					dataset_run_id: "dataset-run-official",
					query: "那第十条呢？",
					reference_tool_calls: [
						{ args: {}, name: "knowledge_query" },
						{
							args: { include_history: false, target: "student_rules" },
							name: "knowledge_search",
						},
					],
					tool_calls: [
						{ args: {}, name: "knowledge_query" },
						{
							args: { include_history: false, target: "student_rules" },
							name: "knowledge_search",
						},
					],
					trace_id: langfuseTraceId,
				},
			],
			schema_version: "ragas_agent_sample_batch.v1",
		});
		expect(writtenRagSamples[0]).toMatchObject({
			items: [
				{
					contexts: ["第十条规定申请人应满足学位授予条件。"],
					dataset_run_id: "dataset-run-official",
					retrieved_context_ids: ["handbook:degree-policy"],
					trace_id: langfuseTraceId,
				},
			],
			schema_version: "ragas_sample_batch.v1",
		});
		expect(result.source_kind).toBe("langfuse_dataset");
		expect(result).toMatchObject({ agent_sample_count: 1, rag_sample_count: 1 });
		const chatRequests = requests.filter((request) =>
			request.url.endsWith("/api/chat/requests/stream"),
		);
		expect(chatRequests).toEqual([
			{
				body: { prompt: "请帮我查一下示例学位授予规定。" },
				url: "https://campus-staging.example/api/chat/requests/stream",
			},
			{
				body: { conversationId: "conv-001", prompt: "那第十条呢？" },
				url: "https://campus-staging.example/api/chat/requests/stream",
			},
		]);
		const runItemRequest = requests.find((request) =>
			request.url.endsWith("/api/public/dataset-run-items"),
		);
		expect(runItemRequest).toMatchObject({
			body: {
				datasetItemId: "dataset-item-001",
				runName: expect.any(String),
				traceId: langfuseTraceId,
			},
			url: "https://langfuse.example/api/public/dataset-run-items",
		});
		const scoreRequests = requests.filter((request) => request.url.endsWith("/api/public/scores"));
		expect(scoreRequests.map((request) => (request.body as JsonObject).name).sort()).toEqual([
			"execution.outcome_match",
			"ragas.faithfulness",
			"ragas.tool_call_accuracy.args",
			"retrieval.forbidden_context_absent",
		]);
		for (const request of scoreRequests) {
			expect(request).toMatchObject({
				body: {
					traceId: langfuseTraceId,
				},
				url: "https://langfuse.example/api/public/scores",
			});
			expect(request.body).not.toHaveProperty("datasetItemId");
			expect(request.body).not.toHaveProperty("datasetRunId");
			expect(request.body).not.toHaveProperty("observationId");
		}
	});
});
