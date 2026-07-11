import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
	buildLangfuseScoresFromRagasAgentScoreBatch,
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

function runStepsResponse(toolTrajectory: JsonObject): Response {
	return jsonResponse({
		agentRuntimeEvalProjection: {
			schema_version: "agent_runtime_eval_projection.v1",
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
	it("runs Langfuse dataset cases through app-api and publishes Ragas agent scores", async () => {
		const requests: Array<{ body: unknown; url: string }> = [];
		const writtenAgentSamples: JsonObject[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/api/public/datasets/campus%2Fagent%2Ftool-selection")) {
				return jsonResponse({
					items: [
						{
							expectedOutput: {
								reference_tool_calls: [
									{
										args: {},
										name: "transport_schedule_lookup",
									},
								],
							},
							id: "dataset-item-001",
							input: {
								query: "校车现在能到海淀校区吗？",
							},
							metadata: {
								argument_mode: "name_only",
								case_family: "transport",
								case_id: "transport-route",
								dataset_run_id: "dataset-run-001",
							},
						},
					],
				});
			}
			if (url.endsWith("/api/chat/requests/stream")) {
				requests.push({
					body: init?.body ? JSON.parse(String(init.body)) : null,
					url,
				});
				return new Response(
					sse("request.accepted", {
						requestId: "req-001",
						runId: "run-001",
						status: "accepted",
						traceId: "trace-001",
					}) +
						sse("request.completed", {
							answer: {
								conversation: {
									id: "conv-001",
									messages: [],
								},
								result: {
									kind: "answer",
									requestId: "req-001",
									text: "已查询校车班次。",
									traceId: "trace-001",
								},
							},
							requestId: "req-001",
							status: "completed",
							traceId: "trace-001",
						}),
					{
						headers: { "content-type": "text/event-stream" },
						status: 200,
					},
				);
			}
			if (url.endsWith("/api/chat/runs/run-001/steps")) {
				return runStepsResponse({
					available_tools: ["knowledge_query", "transport_schedule_lookup"],
					conversation_id: "conv-001",
					decision_kind: "tool_call",
					request_id: "req-001",
					run_id: "run-001",
					schema_version: "tool_trajectory.v1",
					selected_tool: "transport_schedule_lookup",
					surface: "campus-web",
					tool_calls: [
						{
							result_kind: "transport_schedule_lookup",
							status: "completed",
							tool_call_id: "call-001",
							tool_name: "transport_schedule_lookup",
						},
					],
					trace_id: "trace-001",
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
				writeFileSync(
					outputPath,
					JSON.stringify({
						eval_run_id: "agent-eval-run",
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
								},
								trace_id: "trace-001",
							},
						],
						schema_version: "ragas_agent_score_batch.v1",
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
					argument_mode: "name_only",
					case_id: "transport-route",
					dataset_item_id: "dataset-item-001",
					dataset_run_id: "dataset-run-001",
					query: "校车现在能到海淀校区吗？",
					reference_tool_calls: [{ args: {}, name: "transport_schedule_lookup" }],
					tool_calls: [{ args: {}, name: "transport_schedule_lookup" }],
					trace_id: "trace-001",
				},
			],
			schema_version: "ragas_agent_sample_batch.v1",
		});
		expect(result.source_kind).toBe("langfuse_dataset");
		expect(requests[0]).toMatchObject({
			body: { prompt: "校车现在能到海淀校区吗？" },
			url: "https://campus-staging.example/api/chat/requests/stream",
		});
		expect(requests[1]).toMatchObject({
			body: {
				datasetItemId: "dataset-item-001",
				datasetRunId: "dataset-run-001",
				name: "ragas.tool_call_accuracy.name_only",
				traceId: "trace-001",
			},
			url: "https://langfuse.example/api/public/scores",
		});
	});
});
