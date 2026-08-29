import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
	AgentRunner,
	PrimaryAgentStreamEvent,
	ToolExecutionResult,
	UntimedToolExecutionResult,
} from "../src/agent-run-contract.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";

const providerConfig = {
	apiKey: "test-provider-key",
	baseUrl: "https://provider.example/v1",
	model: "gpt-test",
	provider: "openai",
	transport: "responses",
};

const limits = {
	agentDeadlineMs: 90_000,
	contextCharLimit: 16_000,
	currentInputCharLimit: 8_000,
	maxOutputTokens: 2_048,
	maxToolCalls: 3,
	maxTurns: 6,
};

function timedToolResult(
	result: UntimedToolExecutionResult | undefined,
	argumentsJson: Record<string, unknown>,
): ToolExecutionResult | undefined {
	return result === undefined
		? undefined
		: { ...result, argumentsJson, durationMs: 12, toolName: "test_lookup" };
}

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
	schemaVersion: "tool-registry-v6",
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

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}

describe("primary agent runtime", () => {
	it("returns a no-tool final answer without synthetic tool routing", async () => {
		const runner: AgentRunner = async ({ input }) => {
			const currentInput = input.at(-1) as { role?: string; content?: unknown } | undefined;
			const currentText =
				currentInput?.role === "user" && typeof currentInput.content === "string"
					? currentInput.content
					: "";
			return {
				finalOutput: `我是校园问答助手。收到：${currentText}`,
				providerResponseId: "resp_1",
				toolResults: [],
				usage: { modelRequestCount: 1, inputTokens: 12, outputTokens: 8, usageObserved: true },
			} as never;
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
		});

		const result = await runtime.run({
			requestId: "req-no-tool",
			conversationId: "conversation-1",
			input: "hi 你是谁",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(result.status).toBe("completed");
		expect(result.finalOutput).toContain("校园问答助手");
		expect(result.terminalReason).toBe("answer_completed");
		expect(result.toolResults).toEqual([]);
		expect(result.stageTiming).toEqual(
			expect.objectContaining({
				"agent.runtime_ms": expect.any(Number),
			}),
		);
	});

	it("does not advertise or register tools whose catalog exposure is closed", async () => {
		let observedInstructions = "";
		let observedToolNames: string[] = [];
		const runtime = createPrimaryAgentRuntime({
			catalog: {
				...catalog,
				tools: catalog.tools.map((tool) => ({ ...tool, exposure: "closed" as const })),
			},
			runner: async ({ instructions, tools }) => {
				observedInstructions = instructions;
				observedToolNames = tools.map((tool) => tool.name);
				return {
					finalOutput: "当前没有可用的校园事实工具。",
					providerResponseId: "resp_closed_tools",
					toolResults: [],
					usage: { modelRequestCount: 1, inputTokens: 12, outputTokens: 8, usageObserved: true },
				};
			},
		});

		await runtime.run({
			requestId: "req-closed-tools",
			conversationId: "conversation-1",
			input: "今天下一班通知几点发？",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(observedToolNames).toEqual([]);
		expect(observedInstructions).not.toContain("test_lookup");
		expect(observedInstructions).toContain(
			"你是中央民族大学（Minzu University of China）校园问答助手。",
		);
		expect(observedInstructions).toContain(
			"用户未明确指定机构时，所说的学校、本校和校园默认指中央民族大学。",
		);
		expect(observedInstructions).toContain(
			"工具定义描述其能够提供的事实范围；根据当前问题所需事实与工具范围选择工具，不要按具体机构、地点或实体名称建立固定路由特判。",
		);
		expect(observedInstructions).toContain(
			"机构名称本身既不强制也不禁止工具调用；只有工具声明的资料范围和本轮真实返回的证据能够支持事实回答。",
		);
		expect(observedInstructions).toContain(
			"证据只支持问题的一部分时，只回答有证据的部分并清楚说明资料边界；不要补全、推断或伪造未获支持的部分。",
		);
		expect(observedInstructions).toContain(
			"不要编造用户输入、会话上下文或可用工具结果中不存在的事实。",
		);
		expect(observedInstructions).not.toContain("You are the campus-agent primary assistant.");
		expect(observedInstructions).not.toContain("北京大学");
	});

	it("accepts a plain-text no-tool final answer", async () => {
		const runner: AgentRunner = async () => ({
			finalOutput: "我是校园问答助手。",
			providerResponseId: "resp_missing_envelope",
			toolResults: [],
			usage: { modelRequestCount: 1, inputTokens: 12, outputTokens: 8, usageObserved: true },
		});
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			requestId: "req-missing-envelope",
			conversationId: "conversation-1",
			input: "hi 你是谁",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(result.status).toBe("completed");
		expect(result.terminalReason).toBe("answer_completed");
		expect(result.finalOutput).toBe("我是校园问答助手。");
	});

	it("fails closed when the streaming runtime has no streaming runner", async () => {
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async () => ({
				finalOutput: "blocking result must not be used for stream",
				providerResponseId: "resp_blocking",
				toolResults: [],
				usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
			}),
		});

		const events = runtime.stream({
			requestId: "req-stream-missing-runner",
			conversationId: "conversation-1",
			input: "hi",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		await expect(events[Symbol.asyncIterator]().next()).rejects.toThrow(
			"streaming agent runner is required",
		);
	});

	it("stops consuming the streaming runner after its final result", async () => {
		let postTerminalPulled = false;
		let streamingRunnerClosed = false;
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async () => {
				throw new Error("blocking runner must not be used");
			},
			streamingRunner: async function* () {
				try {
					yield {
						delta: "最终答案",
					};
					yield {
						finalOutput: "最终答案",
						providerResponseId: "resp-stream-terminal",
						toolResults: [],
						usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 1, usageObserved: true },
					};
					postTerminalPulled = true;
					yield {
						delta: "must not be consumed",
					};
				} finally {
					streamingRunnerClosed = true;
				}
			},
		});

		const events: PrimaryAgentStreamEvent[] = [];
		for await (const event of runtime.stream({
			requestId: "req-stream-terminal",
			conversationId: "conversation-1",
			input: "hi",
			providerConfig,
			limits,
			visibleToolNames: [],
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.event)).toEqual(["answer_delta", "completed"]);
		expect(postTerminalPulled).toBe(false);
		expect(streamingRunnerClosed).toBe(true);
	});

	it("completes when the streaming runner has final output but no text delta", async () => {
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async () => {
				throw new Error("blocking runner must not be used");
			},
			streamingRunner: async function* () {
				yield {
					finalOutput: "无需增量展示的最终答案。",
					providerResponseId: "resp-stream-no-delta",
					toolResults: [],
					usage: { modelRequestCount: 1, inputTokens: 1, outputTokens: 8, usageObserved: true },
				};
			},
		});

		const events: PrimaryAgentStreamEvent[] = [];
		for await (const event of runtime.stream({
			requestId: "req-stream-no-delta",
			conversationId: "conversation-1",
			input: "hi",
			providerConfig,
			limits,
			visibleToolNames: [],
		})) {
			events.push(event);
		}

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			event: "completed",
			data: {
				status: "completed",
				finalOutput: "无需增量展示的最终答案。",
				terminalReason: "answer_completed",
			},
		});
	});

	it("exposes personal memory through a tool without preloading memory into model context", async () => {
		let observedInstructions = "";
		let observedInput: unknown;
		let observedTools: string[] = [];
		const runner: AgentRunner = async ({ input, instructions, tools }) => {
			observedInstructions = instructions;
			observedInput = input;
			observedTools = tools.map((tool) => tool.name);
			return {
				finalOutput: "我会先给结论。",
				providerResponseId: "resp_memory",
				toolResults: [],
				usage: { modelRequestCount: 1, inputTokens: 16, outputTokens: 8, usageObserved: true },
			};
		};
		const firstTool = catalog.tools[0];
		expect(firstTool).toBeDefined();
		if (!firstTool) {
			throw new Error("tool catalog fixture must contain a tool");
		}
		const runtime = createPrimaryAgentRuntime({
			catalog: {
				...catalog,
				tools: [
					{
						...firstTool,
						name: "personal_memory_recall",
						description: "Recall relevant personal memory for the current request.",
						payloadSchemaRef: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallPayload",
						),
						resultSchemaRef: schemaRef(
							"personal-memory-tool-contracts.v1",
							"PersonalMemoryRecallResult",
						),
					},
				],
			},
			runner,
		});

		await runtime.run({
			requestId: "req-memory",
			conversationId: "conversation-1",
			input: "之后回答能不能先给结论？",
			providerConfig,
			limits,
			visibleToolNames: ["personal_memory_recall"],
			conversationContext: emptyConversationContext(),
		});

		expect(observedTools).toEqual(["personal_memory_recall"]);
		expect(observedInstructions).not.toContain("用户偏好回答先给结论");
		expect(observedInstructions).toContain(
			"personal_memory_recall 可用时，仅在当前问题依赖已保存的用户个人事实或偏好时使用。",
		);
		expect(observedInstructions).toContain(
			"不要编造用户输入、会话上下文或可用工具结果中不存在的事实。",
		);
		expect(observedInstructions).not.toContain("personal memory authorization");
		expect(observedInput).toEqual([{ role: "user", content: "之后回答能不能先给结论？" }]);
	});

	it("returns a safe prompt trace hashed from the rendered runner instructions", async () => {
		const customInstructions = "Answer with the repo-scoped campus assistant policy.";
		let observedInstructions = "";
		let observedInput: unknown;
		const runner: AgentRunner = async ({ input, instructions }) => {
			observedInstructions = instructions;
			observedInput = input;
			return {
				finalOutput: "我会先给结论。",
				providerResponseId: "resp_prompt_trace",
				toolResults: [],
				usage: { modelRequestCount: 1, inputTokens: 18, outputTokens: 8, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			instructions: customInstructions,
			runner,
		});

		const result = await runtime.run({
			requestId: "req-prompt-trace",
			conversationId: "conversation-1",
			input: "之后回答能不能先给结论？",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
			conversationContext: emptyConversationContext(),
		});

		expect(result.promptTrace).toMatchObject({
			schemaVersion: "agent_runtime_prompt_trace.v1",
			promptId: "primary_agent",
			promptTemplateSha256: sha256(customInstructions),
			renderedPromptSha256: sha256(observedInstructions),
		});
		expect(result.toolContractFingerprint).toEqual(catalog.contractFingerprint);
		expect(JSON.stringify(observedInput)).toContain("之后回答能不能先给结论？");
		expect(JSON.stringify(result.promptTrace)).not.toContain(observedInstructions);
	});

	it("injects conversation context without replacing the current user input", async () => {
		let observedInput: unknown;
		let observedInstructions = "";
		const runner: AgentRunner = async ({ input, instructions }) => {
			observedInput = input;
			observedInstructions = instructions;
			return {
				finalOutput: "大一是否可申请需要看转专业办法的年级条件。",
				providerResponseId: "resp_context",
				toolResults: [],
				usage: { modelRequestCount: 1, inputTokens: 32, outputTokens: 12, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });
		const runInput = {
			requestId: "req-context",
			conversationId: "conversation-1",
			input: "那大一能不能申请？",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
			conversationContext: {
				schemaVersion: "agent_conversation_context.v1" as const,
				recentTurns: [
					{
						messageId: "msg_user_001",
						role: "user" as const,
						content: "转专业条件是什么？",
					},
					{
						messageId: "msg_assistant_002",
						role: "assistant" as const,
						content: "上一轮回答的是转专业申请条件。",
					},
				],
				sessionState: {
					confirmedSlots: [
						{
							confirmed: true,
							name: "curriculum_program",
							value: "计算机科学与技术",
						},
					],
				},
			},
		};

		const result = await runtime.run(runInput);

		const encodedInput = JSON.stringify(observedInput);
		expect(encodedInput).toContain("上一轮回答的是转专业申请条件。");
		expect(encodedInput).toContain("curriculum_program");
		expect(encodedInput).not.toContain("ev_transfer_rule_01");
		expect(encodedInput).not.toContain("projection://runs/run_previous_services/finalization");
		expect(encodedInput).toContain("那大一能不能申请？");
		expect(observedInstructions).not.toContain("那大一能不能申请？");
		expect(observedInstructions).not.toContain("用户偏好先看结论");
		expect(result.contextUsage).toMatchObject({
			contextChars: expect.any(Number),
			currentInputChars: 9,
			modelVisibleItemCount: 4,
		});
	});

	it("omits session state that has no model-relevant value", async () => {
		let observedInput: unknown;
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async ({ input }) => {
				observedInput = input;
				return {
					finalOutput: "你好。",
					providerResponseId: "resp_empty_session_state",
					toolResults: [],
					usage: { modelRequestCount: 1, inputTokens: 12, outputTokens: 4, usageObserved: true },
				};
			},
		});

		await runtime.run({
			requestId: "req-empty-session-state",
			conversationId: "conversation-1",
			input: "你好",
			providerConfig,
			limits,
			visibleToolNames: [],
			conversationContext: {
				schemaVersion: "agent_conversation_context.v1",
				recentTurns: [],
				sessionState: {
					confirmedSlots: [],
				},
			},
		});

		const encodedInput = JSON.stringify(observedInput);
		const modelInput = observedInput as Array<{ content: string }>;
		expect(encodedInput).not.toContain("session_state");
		expect(modelInput).toEqual([{ role: "user", content: "你好" }]);
	});

	it("passes visible SDK tools to the runner and records ordered tool results", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const argumentsJson = {
				query_text: "通知今天几点",
				intent: "next_departure",
			};
			const toolResult = timedToolResult(await tools[0]?.execute(argumentsJson), argumentsJson);
			return {
				finalOutput: "通知查询完成。",
				providerResponseId: "resp_2",
				toolResults: toolResult ? [toolResult] : [],
				usage: { modelRequestCount: 1, inputTokens: 20, outputTokens: 10, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ argumentsJson }) => ({
				status: "completed",
				result: {
					outcome: "resolved_current",
					echo: argumentsJson,
				},
			}),
		});

		const result = await runtime.run({
			requestId: "req-tool",
			conversationId: "conversation-1",
			input: "通知今天几点",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(result.status).toBe("completed");
		expect(result.terminalReason).toBe("answer_completed");
		expect(result.toolResults[0]?.result).toMatchObject({ outcome: "resolved_current" });
		expect(result.toolResults[0]?.argumentsJson).toEqual({
			query_text: "通知今天几点",
			intent: "next_departure",
		});
		expect(result.toolResults[0]?.durationMs).toBe(12);
		expect(result.usage.outputTokens).toBe(10);
	});

	it("fails closed when a model-visible typed tool has no executor", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const argumentsJson = { query_text: "通知今天几点" };
			const toolResult = timedToolResult(await tools[0]?.execute(argumentsJson), argumentsJson);
			return {
				finalOutput: "",
				providerResponseId: "resp_missing_tool_executor",
				toolResults: toolResult ? [toolResult] : [],
				usage: { modelRequestCount: 1, inputTokens: 18, outputTokens: 4, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			requestId: "req-missing-tool-executor",
			conversationId: "conversation-1",
			input: "通知今天几点",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(result.status).toBe("failed");
		expect(result.finalOutput).toBe("");
		expect(result.terminalReason).toBe("agent_runtime_failed");
		expect(result.toolResults).toEqual([
			{
				status: "failed",
				toolName: "test_lookup",
				argumentsJson: { query_text: "通知今天几点" },
				result: { error: "tool executor is not configured" },
				failCloseReason: "tool_executor_not_configured",
				durationMs: 12,
			},
		]);
	});

	it("keeps a valid terminal result when a selected tool fails", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const argumentsJson = {
				query_text: "通知今天几点",
				intent: "next_departure",
			};
			const toolResult = timedToolResult(await tools[0]?.execute(argumentsJson), argumentsJson);
			return {
				finalOutput: "通知查询失败。",
				providerResponseId: "resp_failed_tool",
				toolResults: toolResult ? [toolResult] : [],
				usage: { modelRequestCount: 1, inputTokens: 20, outputTokens: 10, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async () => ({
				status: "failed",
				result: {
					error: "source truth unavailable",
				},
				failCloseReason: "source_truth_unavailable",
			}),
		});

		const result = await runtime.run({
			requestId: "req-tool-failed",
			conversationId: "conversation-1",
			input: "通知今天几点",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		});

		expect(result.status).toBe("completed");
		expect(result.terminalReason).toBe("answer_completed");
		expect(result.finalOutput).toBe("通知查询失败。");
		expect(result.toolResults[0]?.failCloseReason).toBe("source_truth_unavailable");
		expect(result.toolResults[0]?.durationMs).toBe(12);
		expect(result.toolResults[0]?.argumentsJson).toEqual({
			query_text: "通知今天几点",
			intent: "next_departure",
		});
	});

	it("keeps streamed output consistent when a selected tool fails", async () => {
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner: async () => {
				throw new Error("blocking runner must not be used");
			},
			streamingRunner: async function* () {
				yield {
					delta: "通知查询失败。",
				};
				yield {
					finalOutput: "通知查询失败。",
					providerResponseId: "resp-stream-failed-tool",
					toolResults: [
						{
							status: "failed",
							toolName: "test_lookup",
							argumentsJson: { query_text: "通知" },
							result: { error: "source truth unavailable" },
							failCloseReason: "source_truth_unavailable",
							durationMs: 12,
						},
					],
					usage: { modelRequestCount: 1, inputTokens: 20, outputTokens: 10, usageObserved: true },
				};
			},
		});

		const events: PrimaryAgentStreamEvent[] = [];
		for await (const event of runtime.stream({
			requestId: "req-stream-failed-tool",
			conversationId: "conversation-1",
			input: "通知",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
		})) {
			events.push(event);
		}

		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			event: "completed",
			data: {
				status: "completed",
				finalOutput: "通知查询失败。",
				terminalReason: "answer_completed",
			},
		});
	});

	it("propagates the run cancellation signal to the runner and selected tool executor", async () => {
		const controller = new AbortController();
		let runnerSignal: AbortSignal | undefined;
		let executorSignal: AbortSignal | undefined;
		const runner: AgentRunner = async ({ signal, tools }) => {
			runnerSignal = signal;
			const argumentsJson = { query_text: "通知今天几点" };
			const toolResult = timedToolResult(await tools[0]?.execute(argumentsJson), argumentsJson);
			return {
				finalOutput: "通知查询完成。",
				providerResponseId: "resp_signal",
				toolResults: toolResult ? [toolResult] : [],
				usage: { modelRequestCount: 1, inputTokens: 20, outputTokens: 10, usageObserved: true },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ signal }) => {
				executorSignal = signal;
				return {
					status: "completed",
					result: { outcome: "resolved_current" },
				};
			},
		});

		const result = await runtime.run({
			requestId: "req-signal",
			conversationId: "conversation-1",
			input: "通知今天几点",
			providerConfig,
			limits,
			visibleToolNames: ["test_lookup"],
			signal: controller.signal,
		});

		expect(result.status).toBe("completed");
		expect(runnerSignal).toBe(controller.signal);
		expect(executorSignal).toBe(controller.signal);
	});
});

function emptyConversationContext() {
	return {
		schemaVersion: "agent_conversation_context.v1" as const,
		recentTurns: [],
	};
}

function sha256(value: string): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function testToolContractFingerprint() {
	return {
		functionSchemaSha256: sha256("function-schema"),
		schemaVersion: "tool_contract_fingerprint.v1" as const,
		toolsSha256: sha256("tool-registry"),
	};
}
