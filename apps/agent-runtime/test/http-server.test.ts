import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";

const catalog: ToolCatalog = {
	schemaVersion: "tool-catalog.v1",
	catalogVersion: "test",
	tools: [
		{
			name: "transport_schedule_lookup",
			capability: "campus_services",
			description: "Lookup campus shuttle schedule snapshots.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: "manual.TransportScheduleLookupPayload",
			resultSchemaRef: "manual.TransportScheduleLookupResult",
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/transport-schedule",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
	],
};

describe("agent runtime HTTP handler", () => {
	it("rejects missing worker authorization", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				body: JSON.stringify(validRunBody()),
			}),
		);

		expect(response.status).toBe(401);
	});

	it("runs a primary agent turn with worker authorization", async () => {
		let observedProvider: unknown;
		let observedMemoryContext: unknown;
		let observedFinalModelContext: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedProvider = input.providerConfig;
					observedMemoryContext = input.memoryContext;
					observedFinalModelContext = input.finalModelContext;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					memory_context: {
						context_block: "用户记忆:\n- 用户偏好先给结论",
						memory_ref: "projection://runs/run_01HQ/memory/recall",
						schema_version: "memory_recall_result_v1",
						selected_memory_chars: 18,
						selected_memory_count: 1,
					},
					final_model_context: {
						schema_version: "final_model_context.v1",
						current_user_message: "那大一能不能申请？",
						recent_turns: [
							{
								message_id: "msg_user_001",
								role: "user",
								content: "转专业条件是什么？",
							},
						],
						previous_answer_summary: "上一轮回答的是转专业申请条件。",
						previous_evidence: [
							{
								access_scope: "public_student_rule",
								content_hash: "sha256:transfer-major-evidence-example",
								document_id: "transfer-major-policy",
								evidence_id: "ev_transfer_rule_01",
								source_id: "regulations/student_rules/transfer-major/v2026",
								title: "本科生转专业管理办法",
								version_id: "rule-transfer-major-2026",
							},
						],
						previous_capability_results: [
							{
								capability: "campus_services",
								content_hash: "sha256:previous-service-result",
								projection_ref: "projection://runs/run_previous_services/finalization",
								request_id: "req_previous_services",
								result_kind: "final_response",
								run_id: "run_previous_services",
								status: "completed",
								summary: "上一轮查询了图书馆开放状态。",
							},
						],
						usage_summary: {
							memory_recall_state: "completed",
							model_visible_item_count: 6,
							runtime_only_item_count: 8,
							token_estimate: 320,
						},
					},
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			final_output?: string;
			model_name?: string;
			model_provider?: string;
			selected_tools?: string[];
			terminal_envelope?: { kind?: string; answer_text?: string };
		};
		expect(body.final_output).toBe("我是校园问答助手。");
		expect(body.model_name).toBe("gpt-5-mini");
		expect(body.model_provider).toBe("openai");
		expect(body.selected_tools).toEqual([]);
		expect(body.terminal_envelope).toEqual({
			kind: "answer",
			answer_text: "我是校园问答助手。",
		});
		expect(observedProvider).toEqual(validRuntimePromptProviderConfig());
		expect(observedMemoryContext).toEqual({
			contextBlock: "用户记忆:\n- 用户偏好先给结论",
			memoryRef: "projection://runs/run_01HQ/memory/recall",
			schemaVersion: "memory_recall_result_v1",
			selectedMemoryChars: 18,
			selectedMemoryCount: 1,
		});
		expect(observedFinalModelContext).toMatchObject({
			schemaVersion: "final_model_context.v1",
			currentUserMessage: "那大一能不能申请？",
			previousAnswerSummary: "上一轮回答的是转专业申请条件。",
			previousEvidence: [
				expect.objectContaining({
					evidenceId: "ev_transfer_rule_01",
					contentHash: "sha256:transfer-major-evidence-example",
				}),
			],
			previousCapabilityResults: [
				expect.objectContaining({
					capability: "campus_services",
					projectionRef: "projection://runs/run_previous_services/finalization",
				}),
			],
			usageSummary: {
				memoryRecallState: "completed",
				modelVisibleItemCount: 6,
				runtimeOnlyItemCount: 8,
				tokenEstimate: 320,
			},
		});
	});

	it("fails closed when provider config is missing from an agent run request", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(validRunBody()),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: string; message?: string } };
		expect(body.error?.code).toBe("invalid_request");
		expect(body.error?.message).toContain("provider_config");
	});

	it("passes the worker request cancellation signal into the primary agent runtime", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedSignal = input.signal;
					return {
						status: "completed",
						runId: input.runId,
						finalOutput: "ok",
						modelName: "gpt-test",
						modelProvider: "openai",
						terminalEnvelope: { kind: "answer", answerText: "ok" },
						providerResponseId: "resp_signal",
						sdkTraceRef: "trace_signal",
						selectedTools: [],
						toolResults: [],
						terminalReason: "answer_completed",
						usage: { inputTokens: 1, outputTokens: 1 },
					};
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
				signal: controller.signal,
			}),
		);

		expect(response.status).toBe(200);
		expect(observedSignal).toBeDefined();
		expect(observedSignal?.aborted).toBe(false);

		controller.abort();

		expect(observedSignal?.aborted).toBe(true);
	});

	it("returns a failed runtime result when a selected tool fails closed", async () => {
		const runner: AgentRunner = async ({ tools }) => ({
			finalOutput: "工具失败。",
			providerResponseId: "resp_tool_failed",
			toolCalls: [
				{
					name: "transport_schedule_lookup",
					argumentsSummary: {},
					result: await tools[0]?.execute({ query_text: "校车" }),
				},
			],
			traceRef: "trace_tool_failed",
			usage: { inputTokens: 1, outputTokens: 1 },
		});
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({
				catalog,
				runner,
				toolExecutor: async ({ tool }) => ({
					status: "failed",
					toolName: tool.name,
					capability: tool.capability,
					payloadKind: tool.name,
					result: { error: "source truth unavailable" },
					resultRef: "agent-runtime://run-1/tools/transport_schedule_lookup/failed",
					failCloseReason: "source_truth_unavailable",
				}),
			}),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			status?: string;
			final_output?: string;
			terminal_reason?: string;
			tool_results?: Array<{
				arguments_json?: Record<string, unknown>;
				fail_close_reason?: string;
			}>;
		};
		expect(body.status).toBe("failed");
		expect(body.final_output).toBe("");
		expect(body.terminal_reason).toBe("agent_runtime_failed");
		expect(body.tool_results?.[0]?.fail_close_reason).toBe("source_truth_unavailable");
		expect(body.tool_results?.[0]?.arguments_json).toEqual({ query_text: "校车" });
	});

	it("fails closed with a diagnostic response when the primary agent runtime throws", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("provider request aborted");
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(500);
		const body = (await response.json()) as {
			error?: { code?: string; message?: string };
		};
		expect(body.error?.code).toBe("agent_runtime_failed");
		expect(body.error?.message).toBe("provider request aborted");
	});
});

describe("agent runtime server env contract", () => {
	it("uses AGENT_RUNTIME-prefixed env names for execution-control internal query config", () => {
		const source = readFileSync(
			fileURLToPath(new URL("../src/server.ts", import.meta.url)),
			"utf8",
		);

		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL");
		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_BASE_URL");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
	});

	it("does not project root provider env into the OpenAI Agents SDK provider", () => {
		const source = readFileSync(
			fileURLToPath(new URL("../src/server.ts", import.meta.url)),
			"utf8",
		);

		expect(source).not.toContain("createOpenAIAgentsRunnerFromEnv");
		expect(source).not.toContain("OPENAI_API_KEY");
	});
});

const noToolRunner: AgentRunner = async () =>
	({
		finalOutput: "我是校园问答助手。",
		terminalEnvelope: { kind: "answer", answerText: "我是校园问答助手。" },
		providerResponseId: "resp_test",
		toolCalls: [],
		traceRef: "trace_test",
		usage: { inputTokens: 1, outputTokens: 1 },
	}) as never;

function validRunBody(): Record<string, unknown> {
	return {
		run_id: "run-1",
		conversation_id: "conversation-1",
		turn_id: "turn-1",
		trace_id: "trace-1",
		input: "hi 你是谁",
		visible_capabilities: ["campus_services"],
	};
}

function validPromptProviderConfig(): Record<string, unknown> {
	return {
		profile_id: "provider-profile-primary",
		revision: 3,
		provider: "openai",
		transport: "responses",
		base_url: "https://api.openai.com/v1",
		model: "gpt-5-mini",
		api_key: "provider-key",
		timeout_ms: 30000,
	};
}

function validRuntimePromptProviderConfig(): Record<string, unknown> {
	return {
		profileId: "provider-profile-primary",
		revision: 3,
		provider: "openai",
		transport: "responses",
		baseUrl: "https://api.openai.com/v1",
		model: "gpt-5-mini",
		apiKey: "provider-key",
		timeoutMs: 30000,
	};
}
