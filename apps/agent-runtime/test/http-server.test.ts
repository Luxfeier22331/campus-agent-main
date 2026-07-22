import { describe, expect, it } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";
import { testPromptTrace, testToolRuntimeFingerprint } from "./helpers/runtime-fingerprint.ts";

const testParameterSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		query_text: { type: "string", minLength: 1 },
	},
	required: ["query_text"],
};

const transportPayloadSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupPayload",
);
const transportResultSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupResult",
);

const catalog: ToolCatalog = {
	schemaVersion: "tool-registry-v5",
	registryVersion: "test",
	runtimeFingerprint: testToolRuntimeFingerprint(),
	tools: [
		{
			name: "transport_schedule_lookup",
			description: "Lookup campus shuttle schedule snapshots.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: transportPayloadSchemaRef,
			resultSchemaRef: transportResultSchemaRef,
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/transport-schedule",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
			parameterSchema: testParameterSchema,
		},
	],
};

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}

describe("agent runtime HTTP handler", () => {
	it("serves healthz without worker authorization", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(new Request("http://agent-runtime/healthz"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
	});

	it("requires the execution shared secret for readiness", async () => {
		const runtime = createPrimaryAgentRuntime({ catalog, runner: noToolRunner });
		const ready = await createAgentRuntimeHandler({ sharedSecret: "secret", runtime })(
			new Request("http://agent-runtime/readyz"),
		);
		const unavailable = await createAgentRuntimeHandler({ sharedSecret: "", runtime })(
			new Request("http://agent-runtime/readyz"),
		);

		expect(ready.status).toBe(200);
		expect(await ready.json()).toEqual({ status: "ready" });
		expect(unavailable.status).toBe(503);
		expect(await unavailable.json()).toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Agent runtime authorization is not configured.",
			},
		});
	});

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
		let observedFinalModelContext: unknown;
		let observedKnowledgeTargets: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedProvider = input.providerConfig;
					observedFinalModelContext = input.finalModelContext;
					observedKnowledgeTargets = input.knowledgeTargets;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					final_model_context: {
						schema_version: "final_model_context.v2",
						recent_turns: [
							{
								message_id: "msg_user_001",
								role: "user",
								content: "转专业条件是什么？",
							},
							{
								message_id: "msg_assistant_002",
								role: "assistant",
								content: "上一轮回答的是转专业申请条件。",
							},
						],
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
						previous_tool_results: [
							{
								content_hash: "sha256:previous-service-result",
								projection_ref: "projection://runs/run_previous_services/finalization",
								request_id: "req_previous_services",
								result_kind: "final_response",
								run_id: "run_previous_services",
								status: "completed",
								summary: "上一轮查询了图书馆开放状态。",
								tool: "transport_schedule_lookup",
							},
						],
						session_state: {
							confirmed_slots: [
								{ confirmed: true, name: "curriculum_program", value: "计算机科学与技术" },
							],
							selected_notice_ref: null,
							turn_count: 2,
						},
						memory_context: {
							context_block: "用户记忆:\n- 用户偏好先给结论",
							memory_ref: "projection://runs/run_01HQ/memory/recall",
							schema_version: "memory_recall_result_v1",
							selected_memory_chars: 18,
							selected_memory_count: 1,
						},
						usage_summary: {
							context_chars: 680,
							current_input_chars: 9,
							memory_recall_state: "completed",
							model_visible_item_count: 6,
							runtime_only_item_count: 8,
						},
					},
					provider_config: validPromptProviderConfig(),
					knowledge_targets: [
						{
							target: "student_rules",
							description: "学生规则、学籍、奖助处分等正式制度。",
						},
					],
				}),
			}),
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			final_output?: string;
			model_name?: string;
			model_provider?: string;
			prompt_trace?: {
				prompt_id?: string;
				prompt_template_sha256?: string;
				rendered_prompt_sha256?: string;
				schema_version?: string;
			};
			selected_tools?: string[];
			terminal_envelope?: { kind?: string; answer_text?: string };
			tool_runtime_fingerprint?: {
				combined_sha256?: string;
				schema_version?: string;
				tools_registry_version?: string;
			};
		};
		expect(body.final_output).toBe("我是校园问答助手。");
		expect(body.model_name).toBe("gpt-5-mini");
		expect(body.model_provider).toBe("openai");
		expect(body.selected_tools).toEqual([]);
		expect(body.terminal_envelope).toEqual({
			kind: "answer",
			answer_text: "我是校园问答助手。",
		});
		expect(body.prompt_trace).toMatchObject({
			prompt_id: "primary_agent",
			schema_version: "agent_runtime_prompt_trace.v1",
			rendered_prompt_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
		});
		expect(body.tool_runtime_fingerprint).toMatchObject({
			combined_sha256: catalog.runtimeFingerprint.combinedSha256,
			schema_version: "tool_runtime_fingerprint.v1",
			tools_registry_version: "test",
		});
		expect(JSON.stringify(body)).not.toMatch(
			/rawPrompt|rawAnswer|rawTranscript|rawProvider|providerPayload|rawSdk|sdkSpan|spanData|traceBody|modelInput|modelOutput/i,
		);
		expect(JSON.stringify(body)).not.toContain("用户偏好先给结论");
		expect(observedProvider).toEqual(validRuntimePromptProviderConfig());
		expect(observedFinalModelContext).toMatchObject({
			schemaVersion: "final_model_context.v2",
			recentTurns: [
				expect.objectContaining({ content: "转专业条件是什么？", role: "user" }),
				expect.objectContaining({
					content: "上一轮回答的是转专业申请条件。",
					role: "assistant",
				}),
			],
			previousEvidence: [
				expect.objectContaining({
					evidenceId: "ev_transfer_rule_01",
					contentHash: "sha256:transfer-major-evidence-example",
				}),
			],
			previousToolResults: [
				expect.objectContaining({
					projectionRef: "projection://runs/run_previous_services/finalization",
					tool: "transport_schedule_lookup",
				}),
			],
			sessionState: {
				confirmedSlots: [
					{ confirmed: true, name: "curriculum_program", value: "计算机科学与技术" },
				],
				selectedNoticeRef: null,
				turnCount: 2,
			},
			usageSummary: {
				contextChars: 680,
				currentInputChars: 9,
				memoryRecallState: "completed",
				modelVisibleItemCount: 6,
				runtimeOnlyItemCount: 8,
			},
			memoryContext: {
				contextBlock: "用户记忆:\n- 用户偏好先给结论",
				memoryRef: "projection://runs/run_01HQ/memory/recall",
			},
		});
		expect(observedKnowledgeTargets).toEqual([
			{
				description: "学生规则、学籍、奖助处分等正式制度。",
				target: "student_rules",
			},
		]);
	});

	it("accepts chat-completions prompt provider profiles at the HTTP boundary", async () => {
		let observedProvider: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedProvider = input.providerConfig;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: {
						...validPromptProviderConfig(),
						provider: "openai-compatible",
						transport: "chat_completions",
					},
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(observedProvider).toMatchObject({
			provider: "openai-compatible",
			transport: "chat_completions",
		});
	});

	it("streams primary agent answer deltas before the terminal result", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking run should not be used by the streaming endpoint");
				},
				async *stream(input) {
					yield {
						event: "answer_delta",
						data: {
							accumulatedText: "国家奖学金",
							chunkIndex: 1,
							delta: "国家奖学金",
						},
					};
					yield {
						event: "answer_delta",
						data: {
							accumulatedText: "国家奖学金每学年评审一次。",
							chunkIndex: 2,
							delta: "每学年评审一次。",
						},
					};
					yield {
						event: "completed",
						data: {
							status: "completed",
							runId: input.runId,
							finalOutput: "国家奖学金每学年评审一次。",
							modelName: input.providerConfig.model,
							modelProvider: input.providerConfig.provider,
							promptTrace: testPromptTrace(),
							terminalEnvelope: {
								kind: "answer",
								answerText: "国家奖学金每学年评审一次。",
							},
							providerResponseId: "resp_stream",
							stageTiming: {
								"agent.runtime_ms": 12,
								"agent.first_delta_ms": 4,
							},
							selectedTools: [],
							toolRuntimeFingerprint: testToolRuntimeFingerprint(),
							toolResults: [],
							terminalReason: "answer_completed",
							usage: { inputTokens: 11, outputTokens: 7 },
						},
					};
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const events = parseSseEvents(await response.text());
		expect(events.map((event) => event.event)).toEqual([
			"answer_delta",
			"answer_delta",
			"completed",
		]);
		expect(events[0]?.data).toMatchObject({
			accumulated_text: "国家奖学金",
			chunk_index: 1,
			delta: "国家奖学金",
			schema_version: "agent_runtime_answer_delta.v1",
		});
		expect(events[2]?.data).toMatchObject({
			final_output: "国家奖学金每学年评审一次。",
			provider_response_id: "resp_stream",
			status: "completed",
			stage_timing: {
				"agent.runtime_ms": 12,
				"agent.first_delta_ms": 4,
			},
			terminal_envelope: {
				answer_text: "国家奖学金每学年评审一次。",
				kind: "answer",
			},
		});
		expect(JSON.stringify(events[2]?.data)).not.toMatch(
			/rawPrompt|rawAnswer|rawTranscript|rawProvider|providerPayload|rawSdk|sdkSpan|spanData|traceBody|modelInput|modelOutput/i,
		);
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

	it("classifies a missing input as an invalid request", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});
		const body = validRunBody();
		delete body.input;

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({ ...body, provider_config: validPromptProviderConfig() }),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "invalid_request", retryable: false },
		});
	});

	it("rejects a current input above the configured character limit", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					input: "超过五个字符",
					limits: { ...validRuntimeLimits(), current_input_char_limit: 5 },
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "context_budget_exceeded", retryable: false },
		});
	});

	it("rejects final model context above its wire character limit", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					final_model_context: {
						schema_version: "final_model_context.v2",
						recent_turns: [{ role: "user", content: "很长的历史上下文".repeat(40) }],
						previous_evidence: [],
						previous_tool_results: [],
						usage_summary: {
							context_chars: 400,
							current_input_chars: 6,
							memory_recall_state: "skipped",
							model_visible_item_count: 1,
							runtime_only_item_count: 0,
						},
					},
					limits: { ...validRuntimeLimits(), context_char_limit: 100 },
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "context_budget_exceeded", retryable: false },
		});
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
						promptTrace: testPromptTrace(),
						terminalEnvelope: { kind: "answer", answerText: "ok" },
						providerResponseId: "resp_signal",
						selectedTools: [],
						stageTiming: {},
						toolRuntimeFingerprint: testToolRuntimeFingerprint(),
						toolResults: [],
						terminalReason: "answer_completed",
						usage: { inputTokens: 1, outputTokens: 1 },
					};
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
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
				stream: throwingAgentRuntimeStream,
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
			error?: { code?: string; message?: string; retryable?: boolean };
		};
		expect(body.error?.code).toBe("run_failed");
		expect(body.error?.message).toBe("provider request aborted");
		expect(body.error?.retryable).toBe(false);
	});

	it("enforces the configured agent deadline", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					await waitForAbort(input.signal);
					throw input.signal?.reason;
				},
				stream: throwingAgentRuntimeStream,
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					limits: { ...validRuntimeLimits(), agent_deadline_ms: 5 },
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(500);
		const body = (await response.json()) as {
			error?: { code?: string; retryable?: boolean };
		};
		expect(body.error).toMatchObject({
			code: "agent_deadline_exceeded",
			retryable: false,
		});
	});

	it("emits a non-retryable terminal SSE error", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking endpoint should not be used");
				},
				stream: throwingAgentRuntimeStream,
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		const events = parseSseEvents(await response.text());
		expect(events).toEqual([
			{
				event: "error",
				data: {
					code: "run_failed",
					message: "provider request aborted",
					retryable: false,
				},
			},
		]);
	});
});

const noToolRunner: AgentRunner = async () =>
	({
		finalOutput: "我是校园问答助手。",
		terminalEnvelope: { kind: "answer", answerText: "我是校园问答助手。" },
		providerResponseId: "resp_test",
		toolCalls: [],
		usage: { inputTokens: 1, outputTokens: 1 },
	}) as never;

function throwingAgentRuntimeStream(): AsyncIterable<never> {
	return {
		[Symbol.asyncIterator]() {
			return {
				async next(): Promise<IteratorResult<never>> {
					throw new Error("provider request aborted");
				},
			};
		},
	};
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
	if (!signal) {
		return Promise.reject(new Error("agent runtime signal is required"));
	}
	if (signal.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) =>
		signal.addEventListener("abort", () => resolve(), { once: true }),
	);
}

function validRunBody(): Record<string, unknown> {
	return {
		activity_attempt: 1,
		user_id: "user-1",
		request_id: "req-1",
		run_id: "run-1",
		conversation_id: "conversation-1",
		turn_id: "turn-1",
		trace_id: "trace-1",
		input: "hi 你是谁",
		visible_tool_names: ["transport_schedule_lookup"],
		limits: validRuntimeLimits(),
	};
}

function validRuntimeLimits(): Record<string, number> {
	return {
		agent_deadline_ms: 90_000,
		context_char_limit: 16_000,
		current_input_char_limit: 8_000,
		max_knowledge_searches: 3,
		max_output_tokens: 2_048,
		max_turns: 6,
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
	};
}

function parseSseEvents(body: string): Array<{ event: string; data: Record<string, unknown> }> {
	return body
		.split("\n\n")
		.map((block) => block.trim())
		.filter((block) => block && !block.startsWith(":"))
		.map((block) => {
			const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
			const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
			if (!(eventLine && dataLine)) {
				throw new Error(`Invalid SSE block: ${block}`);
			}
			return {
				event: eventLine.slice("event: ".length),
				data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
			};
		});
}
