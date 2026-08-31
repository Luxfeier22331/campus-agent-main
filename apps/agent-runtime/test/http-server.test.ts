import { describe, expect, it, vi } from "vitest";
import type { AgentRunner } from "../src/agent-run-contract.ts";
import { createAgentRuntimeHandler as createAgentRuntimeHandlerBase } from "../src/http-server.ts";
import type { ModelConfigClientOptions } from "../src/model-config-client.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";
import { testPromptTrace, testToolContractFingerprint } from "./helpers/runtime-contract.ts";

const testParameterSchema = {
	type: "object" as const,
	additionalProperties: false as const,
	properties: {
		query_text: { type: "string", minLength: 1 },
	},
	required: ["query_text"],
};

const transportPayloadSchemaRef = schemaRef(
	"personal-memory-tool-contracts.v1",
	"PersonalMemoryRecallPayload",
);
const transportResultSchemaRef = schemaRef(
	"personal-memory-tool-contracts.v1",
	"PersonalMemoryRecallResult",
);

const catalog: ToolCatalog = {
	schemaVersion: "tool-registry-v7",
	registryVersion: "test",
	contractFingerprint: testToolContractFingerprint(),
	tools: [
		{
			name: "test_lookup",
			description: "Lookup test record schedule snapshots.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: transportPayloadSchemaRef,
			resultSchemaRef: transportResultSchemaRef,
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/fixture/test",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
			parameterSchema: testParameterSchema,
		},
	],
};

const PRIMARY_AGENT_TARGET_SHA256 =
	"1c8c4cf353f3040aeabe9beb3f3e946acb1c645f95a609ade778d22c920a62ec";
const CHAT_COMPLETIONS_TARGET_SHA256 =
	"1e1042c87f45f46f64438bd9ccd8d21a09d172b67a0b2a9fb655e6e76a7147d2";

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
		expect(await ready.json()).toEqual({ runtime_release: "test-release", status: "ready" });
		expect(unavailable.status).toBe(503);
		expect(await unavailable.json()).toEqual({
			error: {
				code: "dependency_not_ready",
				message: "Agent runtime authorization is not configured.",
			},
		});
	});

	it("authenticates internal readiness with the exact execution shared secret", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "exact-secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const missing = await handler(new Request("http://agent-runtime/internal/readyz"));
		const wrong = await handler(
			new Request("http://agent-runtime/internal/readyz", {
				headers: { authorization: "Bearer exact-secret-x" },
			}),
		);
		const ready = await handler(
			new Request("http://agent-runtime/internal/readyz", {
				headers: { authorization: "Bearer exact-secret" },
			}),
		);

		expect(missing.status).toBe(401);
		expect(wrong.status).toBe(401);
		expect(ready.status).toBe(200);
		expect(await ready.json()).toEqual({ runtime_release: "test-release", status: "ready" });
	});

	it("rejects missing worker authorization", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(401);
	});

	it("rejects an admitted tool contract fingerprint before invoking the model", async () => {
		let modelInvoked = false;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({
				catalog,
				runner: async (input) => {
					modelInvoked = true;
					return noToolRunner(input);
				},
			}),
		});
		const body = validRunBody();
		body.expected_tool_contract_fingerprint = {
			...wireToolContractFingerprint(catalog.contractFingerprint),
			tools_sha256: `sha256:${"0".repeat(64)}`,
		};

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(body),
			}),
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: "tool_contract_mismatch", retryable: false },
			runtime_release: "test-release",
		});
		expect(modelInvoked).toBe(false);
	});

	it("runs a primary agent turn with worker authorization", async () => {
		let observedProvider: unknown;
		let observedConversationContext: unknown;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run(input) {
					observedProvider = input.providerConfig;
					observedConversationContext = input.conversationContext;
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).run(input);
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					conversation_context: {
						schema_version: "agent_conversation_context.v1",
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
						session_state: {
							confirmed_slots: [
								{ confirmed: true, name: "curriculum_program", value: "计算机科学与技术" },
							],
						},
					},
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
			tool_contract_fingerprint?: {
				schema_version?: string;
				tools_sha256?: string;
			};
			runtime_release?: string;
			usage?: {
				model_request_count?: number;
				usage_observed?: boolean;
			};
			context_usage?: {
				context_chars?: number;
				current_input_chars?: number;
				model_visible_item_count?: number;
			};
		};
		expect(body.final_output).toBe("我是校园问答助手。");
		expect(body.model_name).toBe("gpt-5-mini");
		expect(body.model_provider).toBe("openai");
		expect(body.prompt_trace).toMatchObject({
			prompt_id: "primary_agent",
			schema_version: "agent_runtime_prompt_trace.v1",
			rendered_prompt_sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
		});
		expect(body.tool_contract_fingerprint).toMatchObject({
			schema_version: "tool_contract_fingerprint.v1",
			tools_sha256: catalog.contractFingerprint.toolsSha256,
		});
		expect(body.runtime_release).toBe("test-release");
		expect(body.usage).toMatchObject({
			model_request_count: 1,
			usage_observed: true,
		});
		expect(body.context_usage).toMatchObject({
			context_chars: expect.any(Number),
			current_input_chars: 6,
			model_visible_item_count: 4,
		});
		expect(JSON.stringify(body)).not.toMatch(
			/rawPrompt|rawAnswer|rawTranscript|rawProvider|providerPayload|rawSdk|sdkSpan|spanData|traceBody|modelInput|modelOutput/i,
		);
		expect(JSON.stringify(body)).not.toContain("用户偏好先给结论");
		expect(observedProvider).toEqual(validRuntimePromptProviderConfig());
		expect(observedConversationContext).toMatchObject({
			schemaVersion: "agent_conversation_context.v1",
			recentTurns: [
				expect.objectContaining({ content: "转专业条件是什么？", role: "user" }),
				expect.objectContaining({
					content: "上一轮回答的是转专业申请条件。",
					role: "assistant",
				}),
			],
			sessionState: {
				confirmedSlots: [
					{ confirmed: true, name: "curriculum_program", value: "计算机科学与技术" },
				],
			},
		});
	});

	it("accepts chat-completions LLM settings at the HTTP boundary", async () => {
		let observedProvider: unknown;
		const handler = createAgentRuntimeHandler({
			modelConfig: modelConfigClient({
				api_protocol: "openai.chat_completions",
				provider: "openai-compatible",
			}),
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
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					expected_model_target_sha256: CHAT_COMPLETIONS_TARGET_SHA256,
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
		let postTerminalPulled = false;
		let streamClosed = false;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking run should not be used by the streaming endpoint");
				},
				async *stream(input) {
					try {
						yield {
							event: "answer_delta",
							data: {
								delta: "国家奖学金",
							},
						};
						yield {
							event: "answer_delta",
							data: {
								delta: "每学年评审一次。",
							},
						};
						yield {
							event: "completed",
							data: {
								status: "completed",
								requestId: input.requestId,
								contextUsage: {
									contextChars: 48,
									currentInputChars: 6,
									modelVisibleItemCount: 1,
								},
								finalOutput: "国家奖学金每学年评审一次。",
								modelName: input.providerConfig.model,
								modelProvider: input.providerConfig.provider,
								promptTrace: testPromptTrace(),
								providerResponseId: "resp_stream",
								stageTiming: {
									"agent.runtime_ms": 12,
									"agent.first_delta_ms": 4,
								},
								toolContractFingerprint: testToolContractFingerprint(),
								toolResults: [],
								webCitations: [],
								webSearchUsed: false,
								terminalReason: "answer_completed",
								usage: {
									modelRequestCount: 1,
									inputTokens: 11,
									outputTokens: 7,
									usageObserved: true,
								},
							},
						};
						postTerminalPulled = true;
						yield {
							event: "answer_delta",
							data: {
								delta: "must not be emitted",
							},
						};
					} finally {
						streamClosed = true;
					}
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
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
			delta: "国家奖学金",
			schema_version: "agent_runtime_answer_delta.v3",
		});
		expect(events[2]?.data).toMatchObject({
			final_output: "国家奖学金每学年评审一次。",
			provider_response_id: "resp_stream",
			status: "completed",
			stage_timing: {
				"agent.runtime_ms": 12,
				"agent.first_delta_ms": 4,
			},
		});
		expect(JSON.stringify(events[2]?.data)).not.toMatch(
			/rawPrompt|rawAnswer|rawTranscript|rawProvider|providerPayload|rawSdk|sdkSpan|spanData|traceBody|modelInput|modelOutput/i,
		);
		expect(postTerminalPulled).toBe(false);
		await vi.waitFor(() => expect(streamClosed).toBe(true));
	});

	it("rejects the retired inline provider config field", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					provider_config: validPromptProviderConfig(),
				}),
			}),
		);

		expect(response.status).toBe(400);
		const body = (await response.json()) as { error?: { code?: string; message?: string } };
		expect(body.error?.code).toBe("invalid_request");
		expect(body.error?.message).toBe("The agent runtime request is invalid.");
	});

	it("classifies a missing input as an invalid request", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});
		const body = validRunBody();
		delete body.input;

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(body),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "invalid_request", retryable: false },
		});
	});

	it("accepts an admitted direct-answer request without retrieval context", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(validRunBody()),
			}),
		);

		expect(response.status).toBe(200);
	});

	it("rejects the retired Campus Docs evidence field at the HTTP boundary", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					campus_docs_evidence: [],
				}),
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
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					input: "超过五个字符",
					limits: { ...validRuntimeLimits(), current_input_char_limit: 5 },
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: { code: "context_budget_exceeded", retryable: false },
		});
	});

	it("truncates oversized conversation history where model input is assembled", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({ catalog, runner: noToolRunner }),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					conversation_context: {
						schema_version: "agent_conversation_context.v1",
						recent_turns: [{ role: "user", content: "很长的历史上下文".repeat(40) }],
					},
					limits: { ...validRuntimeLimits(), context_char_limit: 200 },
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			context_usage: {
				current_input_chars: 6,
				model_visible_item_count: 1,
				truncation_summary: {
					dropped_category_counts: { recent_turns: 1 },
					schema_version: "truncation_summary.v3",
				},
			},
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
						requestId: input.requestId,
						contextUsage: {
							contextChars: 48,
							currentInputChars: 6,
							modelVisibleItemCount: 1,
						},
						finalOutput: "ok",
						modelName: "gpt-test",
						modelProvider: "openai",
						promptTrace: testPromptTrace(),
						providerResponseId: "resp_signal",
						stageTiming: {},
						toolContractFingerprint: testToolContractFingerprint(),
						toolResults: [],
						webCitations: [],
						webSearchUsed: false,
						terminalReason: "answer_completed",
						usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
					};
				},
				stream(input) {
					return createPrimaryAgentRuntime({ catalog, runner: noToolRunner }).stream(input);
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
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

	it("returns a completed runtime result when a selected tool reports failure", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const argumentsJson = { query_text: "通知" };
			const result = await tools[0]?.execute(argumentsJson);
			return {
				finalOutput: "工具失败。",
				providerResponseId: "resp_tool_failed",
				toolResults:
					result === undefined
						? []
						: [
								{
									...result,
									argumentsJson,
									durationMs: 12,
									invocationId: "test-call-1",
									toolName: "test_lookup",
								},
							],
				webCitations: [],
				webSearchUsed: false,
				usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
			};
		};
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({
				catalog,
				runner,
				toolExecutor: async () => ({
					status: "failed",
					result: { error: "source truth unavailable" },
					failure: {
						code: "source_truth_unavailable",
						operation: "tool.test_lookup",
						detail: "source truth unavailable",
					},
				}),
			}),
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
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
				duration_ms?: number;
				invocation_id?: string;
				failure?: { code?: string; operation?: string; detail?: string; invocation_id?: string };
			}>;
		};
		expect(body.status).toBe("completed");
		expect(body.final_output).toBe("工具失败。");
		expect(body.terminal_reason).toBe("answer_completed");
		expect(body.tool_results?.[0]?.failure).toMatchObject({
			code: "source_truth_unavailable",
			operation: "tool.test_lookup",
		});
		expect(body.tool_results?.[0]?.arguments_json).toEqual({ query_text: "通知" });
		expect(body.tool_results?.[0]?.duration_ms).toBe(12);
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
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
				}),
			}),
		);

		expect(response.status).toBe(500);
		const body = (await response.json()) as {
			error?: { code?: string; message?: string; retryable?: boolean };
		};
		expect(body.error?.code).toBe("run_failed");
		expect(body.error?.message).toBe("The agent runtime could not complete the request.");
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
			new Request("http://agent-runtime/internal/agent-requests", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					limits: { ...validRuntimeLimits(), agent_deadline_ms: 5 },
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

	it("classifies the configured agent deadline on the streaming route", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking endpoint should not be used");
				},
				async *stream(input) {
					await waitForAbort(input.signal);
					if (input.signal?.aborted) {
						throw input.signal.reason;
					}
					yield* throwingAgentRuntimeStream();
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
					limits: { ...validRuntimeLimits(), agent_deadline_ms: 5 },
				}),
			}),
		);

		expect(parseSseEvents(await response.text())).toEqual([
			{
				event: "error",
				data: {
					code: "agent_deadline_exceeded",
					detail: "agent deadline signal was aborted",
					message: "Agent run exceeded its configured deadline.",
					operation: "agent.runtime",
					retryable: false,
					runtime_release: "test-release",
				},
			},
		]);
	});

	it("emits an SSE error when the runtime ends without a terminal event", async () => {
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking endpoint should not be used");
				},
				async *stream() {
					yield {
						event: "answer_delta",
						data: { delta: "partial" },
					};
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify({
					...validRunBody(),
				}),
			}),
		);

		expect(parseSseEvents(await response.text())).toEqual([
			{
				event: "answer_delta",
				data: {
					delta: "partial",
					schema_version: "agent_runtime_answer_delta.v3",
				},
			},
			{
				event: "error",
				data: {
					code: "run_failed",
					message: "The agent runtime could not complete the request.",
					operation: "agent.runtime",
					retryable: false,
					runtime_release: "test-release",
				},
			},
		]);
	});

	it("emits a non-retryable terminal SSE error", async () => {
		const onStreamError = vi.fn();
		const handler = createAgentRuntimeHandler({
			onStreamError,
			sharedSecret: "secret",
			runtime: {
				async run() {
					throw new Error("blocking endpoint should not be used");
				},
				stream: throwingAgentRuntimeStream,
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(validRunBody()),
			}),
		);

		const events = parseSseEvents(await response.text());
		expect(events).toEqual([
			{
				event: "error",
				data: {
					code: "run_failed",
					message: "The agent runtime could not complete the request.",
					operation: "agent.runtime",
					retryable: false,
					runtime_release: "test-release",
				},
			},
		]);
		expect(onStreamError).toHaveBeenCalledOnce();
		expect(onStreamError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
	});

	it("rejects tool contract drift on the streaming route before invoking the model", async () => {
		let modelInvoked = false;
		const handler = createAgentRuntimeHandler({
			sharedSecret: "secret",
			runtime: createPrimaryAgentRuntime({
				catalog,
				runner: noToolRunner,
				streamingRunner: async function* (input) {
					modelInvoked = true;
					yield await noToolRunner(input);
				},
			}),
		});
		const body = validRunBody();
		body.expected_tool_contract_fingerprint = {
			...wireToolContractFingerprint(catalog.contractFingerprint),
			tools_sha256: `sha256:${"0".repeat(64)}`,
		};

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-requests/stream", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(body),
			}),
		);

		expect(parseSseEvents(await response.text())).toEqual([
			{
				event: "error",
				data: {
					code: "tool_contract_mismatch",
					message: "The admitted tool contract does not match this agent runtime.",
					operation: "agent.runtime",
					retryable: false,
					runtime_release: "test-release",
				},
			},
		]);
		expect(modelInvoked).toBe(false);
	});
});

const noToolRunner: AgentRunner = async () =>
	({
		finalOutput: "我是校园问答助手。",
		providerResponseId: "resp_test",
		toolResults: [],
		webCitations: [],
		webSearchUsed: false,
		usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
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
		conversation_id: "conversation-1",
		input: "hi 你是谁",
		visible_function_tool_names: ["test_lookup"],
		expected_tool_contract_fingerprint: wireToolContractFingerprint(catalog.contractFingerprint),
		expected_model_target_sha256: PRIMARY_AGENT_TARGET_SHA256,
		limits: validRuntimeLimits(),
	};
}

function wireToolContractFingerprint(fingerprint: ToolCatalog["contractFingerprint"]) {
	return {
		function_schema_sha256: fingerprint.functionSchemaSha256,
		schema_version: fingerprint.schemaVersion,
		tools_sha256: fingerprint.toolsSha256,
	};
}

function validRuntimeLimits(): Record<string, number> {
	return {
		agent_deadline_ms: 90_000,
		context_char_limit: 16_000,
		current_input_char_limit: 8_000,
		max_output_tokens: 2_048,
		max_function_tool_calls: 3,
		max_turns: 6,
	};
}

function validPromptProviderConfig(): Record<string, unknown> {
	return {
		provider: "openai",
		transport: "responses",
		base_url: "https://api.openai.com/v1",
		model: "gpt-5-mini",
		api_key: "provider-key",
	};
}

function createAgentRuntimeHandler(
	options: Omit<
		Parameters<typeof createAgentRuntimeHandlerBase>[0],
		"modelConfig" | "runtimeRelease"
	> & {
		modelConfig?: ModelConfigClientOptions;
		runtimeRelease?: string;
	},
) {
	return createAgentRuntimeHandlerBase({
		...options,
		modelConfig: options.modelConfig ?? modelConfigClient(),
		runtimeRelease: options.runtimeRelease ?? "test-release",
	});
}

function modelConfigClient(
	overrides: Partial<{ api_protocol: string; provider: string }> = {},
): ModelConfigClientOptions {
	return {
		baseUrl: "http://model-config",
		fetchImplementation: async () => {
			const apiProtocol = overrides.api_protocol ?? "openai.responses";
			const provider = overrides.provider ?? "openai";
			const targetSha256 =
				apiProtocol === "openai.chat_completions" && provider === "openai-compatible"
					? CHAT_COMPLETIONS_TARGET_SHA256
					: PRIMARY_AGENT_TARGET_SHA256;
			return Response.json({
				api_key: "provider-key",
				api_protocol: apiProtocol,
				base_url: "https://api.openai.com/v1",
				model: "gpt-5-mini",
				name: "primary_agent",
				provider,
				schema_version: "model_runtime_config.v1",
				target_sha256: targetSha256,
			});
		},
	};
}

function validRuntimePromptProviderConfig(): Record<string, unknown> {
	return {
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
