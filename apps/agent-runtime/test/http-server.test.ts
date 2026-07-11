import { describe, expect, it } from "vitest";
import { deriveLangfuseTraceId } from "../src/debug-trace.ts";
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
	schemaVersion: "tool-registry-v4",
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
		let observedDebugTraceConfig: unknown;
		let observedAllowedKnowledgeScopes: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedProvider = input.providerConfig;
					observedMemoryContext = input.memoryContext;
					observedFinalModelContext = input.finalModelContext;
					observedDebugTraceConfig = input.debugTraceConfig;
					observedAllowedKnowledgeScopes = input.allowedKnowledgeScopes;
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
							},
						],
						session_state: {
							confirmed_slots: [
								{ confirmed: true, name: "curriculum_program", value: "计算机科学与技术" },
							],
							selected_notice_ref: null,
							turn_count: 2,
						},
						usage_summary: {
							memory_recall_state: "completed",
							model_visible_item_count: 6,
							runtime_only_item_count: 8,
							token_estimate: 320,
						},
					},
					provider_config: validPromptProviderConfig(),
					debug_trace_config: validDebugTraceConfig(),
					allowed_knowledge_scopes: [
						{
							scope: "student_rules",
							description: "学生规则、学籍、奖助处分等正式制度。",
							allowed_query_modes: ["current"],
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
				memoryRecallState: "completed",
				modelVisibleItemCount: 6,
				runtimeOnlyItemCount: 8,
				tokenEstimate: 320,
			},
		});
		expect(observedDebugTraceConfig).toEqual({
			includeModelIo: false,
			langfuseOtlp: {
				authHeader: "Basic langfuse-secret",
				endpoint: "https://cloud.langfuse.com/api/public/otel",
				publicTraceBaseUrl: "https://cloud.langfuse.com/project/demo/traces",
			},
			mode: "langfuse_otlp",
			sampleRatio: 1,
			schemaVersion: "llm_debug_trace_config.v1",
		});
		expect(observedAllowedKnowledgeScopes).toEqual([
			{
				allowedQueryModes: ["current"],
				description: "学生规则、学籍、奖助处分等正式制度。",
				scope: "student_rules",
			},
		]);
	});

	it("rejects incomplete enabled LLM debug trace config at the HTTP boundary", async () => {
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
					provider_config: validPromptProviderConfig(),
					debug_trace_config: {
						schema_version: "llm_debug_trace_config.v1",
						mode: "langfuse_otlp",
						include_model_io: false,
						sample_ratio: 1,
					},
				}),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: string; message?: string } };
		expect(body.error?.code).toBe("invalid_request");
		expect(body.error?.message).toContain("langfuse_otlp");
	});

	it("accepts policy-admitted raw model IO at the HTTP boundary", async () => {
		let observedDebugTraceConfig: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedDebugTraceConfig = input.debugTraceConfig;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});
		const rawCapturePolicy = validRawCapturePolicy();

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
					debug_trace_config: {
						...validDebugTraceConfig(),
						include_model_io: true,
						raw_capture_policy: rawCapturePolicy,
					},
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(observedDebugTraceConfig).toMatchObject({
			includeModelIo: true,
			rawCapturePolicy,
		});
	});

	it("rejects raw model IO without raw capture policy at the HTTP boundary", async () => {
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
					provider_config: validPromptProviderConfig(),
					debug_trace_config: {
						...validDebugTraceConfig(),
						include_model_io: true,
					},
				}),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: string; message?: string } };
		expect(body.error?.code).toBe("invalid_request");
		expect(body.error?.message).toContain("raw_capture_policy");
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
		const langfuseTraceId = deriveLangfuseTraceId("trace-1");
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
							sdkTraceRef: "trace_stream",
							debugTraceRefs: [
								{
									sink: "langfuse_otlp",
									traceId: langfuseTraceId,
									traceRef: `langfuse://${langfuseTraceId}`,
									url: `https://cloud.langfuse.com/project/demo/traces/${langfuseTraceId}`,
								},
							],
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
					debug_trace_config: validDebugTraceConfig(),
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
			debug_trace_refs: [
				{
					sink: "langfuse_otlp",
					trace_id: langfuseTraceId,
					trace_ref: `langfuse://${langfuseTraceId}`,
					url: `https://cloud.langfuse.com/project/demo/traces/${langfuseTraceId}`,
				},
			],
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
						sdkTraceRef: "trace_signal",
						debugTraceRefs: [],
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
			error?: { code?: string; message?: string };
		};
		expect(body.error?.code).toBe("agent_runtime_failed");
		expect(body.error?.message).toBe("provider request aborted");
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

function validRunBody(): Record<string, unknown> {
	return {
		request_id: "req-1",
		run_id: "run-1",
		conversation_id: "conversation-1",
		turn_id: "turn-1",
		trace_id: "trace-1",
		input: "hi 你是谁",
		visible_tool_names: ["transport_schedule_lookup"],
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

function validDebugTraceConfig(): Record<string, unknown> {
	return {
		schema_version: "llm_debug_trace_config.v1",
		mode: "langfuse_otlp",
		include_model_io: false,
		sample_ratio: 1,
		langfuse_otlp: {
			endpoint: "https://cloud.langfuse.com/api/public/otel",
			auth_header: "Basic langfuse-secret",
			public_trace_base_url: "https://cloud.langfuse.com/project/demo/traces",
		},
	};
}

function validRawCapturePolicy(): Record<string, unknown> {
	return {
		schema_version: "raw_capture_policy.v1",
		mode: "manual_run_capture",
		capture_reason: "diagnose badcase req_debug_001",
		ttl_days: 7,
		allowed_sinks: ["openai_agents_trace", "langfuse_otlp"],
		allowed_raw_fields: ["rendered_messages", "provider_request_body"],
		operator_principal: "operator:test",
		approval_ref: "approval:test:raw-capture",
		request_id: "req-1",
		run_id: "run-1",
		trace_id: "trace-1",
		audit_required: true,
		dsar_delete_linkage_required: true,
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
