import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult, UntimedToolExecutionResult } from "../src/agent-run-contract.ts";
import { createOpenAIAgentsRunner, createStreamingOpenAIAgentsRunner } from "../src/sdk-runner.ts";

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
	maxToolCalls: 10,
	maxTurns: 6,
};

function queryParameters() {
	return {
		type: "object" as const,
		additionalProperties: false as const,
		properties: {
			query_text: { type: "string" },
		},
		required: ["query_text"],
	};
}

function completedToolResult(
	toolName: string,
	result: Record<string, unknown> = { outcome: "resolved_current" },
	resultRef = `agent-runtime://test/tools/${toolName}`,
): UntimedToolExecutionResult {
	return {
		status: "completed",
		toolName,
		payloadKind: toolName,
		result,
		resultRef,
	};
}

describe("OpenAI Agents SDK runner adapter", () => {
	it("registers admitted runtime tools and preserves invocation identity", async () => {
		let observedArguments: unknown;
		let observedContext: unknown;
		let observedResult: ToolExecutionResult | undefined;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent, _input, options) => {
				expect(agent.modelSettings.maxTokens).toBe(2_048);
				expect(options.maxTurns).toBe(6);
				expect(agent.handoffs).toEqual([]);
				expect(agent.tools.map((item: { name: string }) => item.name)).toEqual([
					"personal_memory_recall",
				]);
				const memoryTool = agent.tools[0];
				if (memoryTool?.type !== "function") {
					throw new Error("personal_memory_recall function tool is required");
				}
				const argumentsJson = { query_text: "我的回答偏好" };
				observedResult = (await memoryTool.invoke(
					new RunContext(options.context),
					JSON.stringify(argumentsJson),
					{
						toolCall: {
							type: "function_call",
							callId: "call-memory-1",
							name: "personal_memory_recall",
							arguments: JSON.stringify(argumentsJson),
						},
					},
				)) as ToolExecutionResult;
				return {
					finalOutput: { kind: "answer", answerText: "我会先给结论。" },
					lastResponseId: "resp-sdk-memory",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "按我的偏好回答" }],
			instructions: "Recall personal memory only when it helps answer the current request.",
			tools: [
				{
					name: "personal_memory_recall",
					description: "Recall relevant personal memory.",
					parameters: queryParameters(),
					execute: async (argumentsJson, context) => {
						observedArguments = argumentsJson;
						observedContext = context;
						return completedToolResult("personal_memory_recall");
					},
				},
			],
			requestId: "req-sdk-memory",
			runId: "run-sdk-memory",
			traceId: "trace-sdk-memory",
			limits,
			providerConfig,
		});

		expect(observedArguments).toEqual({ query_text: "我的回答偏好" });
		expect(observedContext).toEqual({ invocationId: "call-memory-1" });
		expect(observedResult).toMatchObject({
			status: "completed",
			toolName: "personal_memory_recall",
		});
		expect(observedResult?.durationMs).toBeGreaterThan(0);
	});

	it("fails closed after the admitted tool-call budget is exhausted", async () => {
		let executeCount = 0;
		let exhaustedResult: ToolExecutionResult | undefined;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent, _input, options) => {
				const runtimeTool = agent.tools[0];
				if (runtimeTool?.type !== "function") {
					throw new Error("runtime function tool is required");
				}
				const runContext = new RunContext(options.context);
				const invoke = (callId: string) =>
					runtimeTool.invoke(runContext, JSON.stringify({ query_text: "通知" }), {
						toolCall: {
							type: "function_call",
							callId,
							name: "test_lookup",
							arguments: JSON.stringify({ query_text: "通知" }),
						},
					});
				await invoke("call-transport-1");
				exhaustedResult = (await invoke("call-transport-2")) as ToolExecutionResult;
				return {
					finalOutput: { kind: "answer", answerText: "已查询。" },
					lastResponseId: "resp-sdk-budget",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "查询通知" }],
			instructions: "Use admitted tools when needed.",
			tools: [
				{
					name: "test_lookup",
					description: "Lookup shuttle schedules.",
					parameters: queryParameters(),
					execute: async () => {
						executeCount += 1;
						return completedToolResult("test_lookup");
					},
				},
			],
			requestId: "req-sdk-budget",
			runId: "run-sdk-budget",
			traceId: "trace-sdk-budget",
			limits: { ...limits, maxToolCalls: 1 },
			providerConfig,
		});

		expect(executeCount).toBe(1);
		expect(exhaustedResult).toMatchObject({
			failCloseReason: "tool_call_budget_exhausted",
			status: "failed",
			toolName: "test_lookup",
		});
	});

	it("passes configured model and provider to the SDK runner", async () => {
		const modelProvider = {
			async getModel() {
				throw new Error("model provider should be consumed by the SDK runner, not this test");
			},
		};
		let observedModel: unknown;
		let observedModelProvider: unknown;
		const runner = createOpenAIAgentsRunner({
			model: "gpt-agent",
			modelProvider,
			runSdk: async (agent, _input, options) => {
				observedModel = agent.model;
				observedModelProvider = options.modelProvider;
				expect(agent.modelSettings).toMatchObject({ maxTokens: 2_048 });
				return {
					finalOutput: "done",
					lastResponseId: "resp-sdk-provider",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "hi" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-provider",
			runId: "run-sdk-provider",
			traceId: "trace-run-sdk-provider",
			limits,
			providerConfig,
		});

		expect(observedModel).toBe("gpt-agent");
		expect(observedModelProvider).toBe(modelProvider);
	});

	it("configures typed terminal output and preserves the SDK structured final output", async () => {
		let observedOutputType: unknown;
		const structuredOutput = {
			kind: "answer",
			answerText: "我是校园问答助手。",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent) => {
				observedOutputType = (agent as { outputType?: unknown }).outputType;
				return {
					finalOutput: structuredOutput,
					lastResponseId: "resp-sdk-structured-output",
					newItems: [],
				};
			},
		});

		const result = await runner({
			input: [{ role: "user", content: "hi 你是谁" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-structured-output",
			runId: "run-sdk-structured-output",
			traceId: "trace-run-sdk-structured-output",
			limits,
			providerConfig,
		});

		expect(observedOutputType).toMatchObject({
			type: "json_schema",
			name: "primary_agent_terminal_output",
			strict: true,
			schema: {
				additionalProperties: false,
				required: ["kind", "answerText", "followUpQuestion", "reason"],
			},
		});
		expect((result as { terminalEnvelope?: unknown }).terminalEnvelope).toEqual(structuredOutput);
		expect(result.finalOutput).toBe("我是校园问答助手。");
	});

	it("accepts empty optional follow-up fields from structured SDK output", async () => {
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: {
					kind: "answer",
					answerText: "我是校园问答助手。",
					followUpQuestion: "",
				},
				lastResponseId: "resp-sdk-empty-follow-up",
				newItems: [],
			}),
		});

		const result = await runner({
			input: [{ role: "user", content: "hi 你是谁" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-empty-follow-up",
			runId: "run-sdk-empty-follow-up",
			traceId: "trace-run-sdk-empty-follow-up",
			limits,
			providerConfig,
		});

		expect((result as { terminalEnvelope?: unknown }).terminalEnvelope).toEqual({
			kind: "answer",
			answerText: "我是校园问答助手。",
		});
		expect(result.finalOutput).toBe("我是校园问答助手。");
	});

	it("projects tool calls, provider response IDs, and usage from SDK run results", async () => {
		const toolResult: ToolExecutionResult = {
			durationMs: 17.5,
			status: "completed",
			toolName: "test_lookup",
			payloadKind: "test_lookup",
			argumentsJson: { intent: "next_departure" },
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/test_lookup",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async (_agent, input) => {
				const currentInput = input.at(-1) as { role?: string; content?: unknown } | undefined;
				return {
					finalOutput: `final:${
						currentInput?.role === "user" && typeof currentInput.content === "string"
							? currentInput.content
							: ""
					}`,
					trace: { traceId: "trace-sdk-001" },
					lastResponseId: "resp-sdk-001",
					usage: {
						requests: 2,
						inputTokens: 21,
						outputTokens: 13,
						cachedInputTokens: 5,
					},
					newItems: [
						{
							type: "tool_call_item",
							rawItem: {
								name: "test_lookup",
								callId: "call-transport",
								arguments: { intent: "next_departure" },
							},
						},
						{
							type: "tool_call_output_item",
							rawItem: {
								callId: "call-transport",
								output: toolResult,
							},
						},
					],
				};
			},
		});

		const result = await runner({
			input: [{ role: "user", content: "通知今天几点" }],
			instructions: "Answer with tools when needed.",
			tools: [
				{
					name: "test_lookup",
					description: "Lookup test record schedule snapshots.",
					execute: async () => toolResult,
				},
			],
			requestId: "req-sdk",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			limits,
			providerConfig,
		});

		expect(result.finalOutput).toBe("final:通知今天几点");
		expect(result.providerResponseId).toBe("resp-sdk-001");
		expect(result.toolCalls).toEqual([
			{
				name: "test_lookup",
				argumentsSummary: { intent: "next_departure" },
				result: toolResult,
			},
		]);
		expect(result.usage).toEqual({
			modelRequestCount: 2,
			inputTokens: 21,
			outputTokens: 13,
			cachedInputTokens: 5,
			usageObserved: true,
		});
	});

	it("distinguishes a missing SDK usage summary from explicit zero usage", async () => {
		const withoutUsage = createOpenAIAgentsRunner({
			runSdk: async () => ({ finalOutput: "done", newItems: [] }),
		});
		const withZeroUsage = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: "done",
				newItems: [],
				usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
			}),
		});
		const input = {
			input: [{ role: "user" as const, content: "hello" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-usage",
			runId: "run-sdk-usage",
			traceId: "trace-sdk-usage",
			limits,
			providerConfig,
		};

		await expect(withoutUsage(input)).resolves.toMatchObject({
			usage: { modelRequestCount: 0, usageObserved: false },
		});
		await expect(withZeroUsage(input)).resolves.toMatchObject({
			usage: { modelRequestCount: 0, usageObserved: true },
		});
	});

	it("matches SDK tool outputs by call ID when output items are interleaved", async () => {
		const firstResult: ToolExecutionResult = {
			durationMs: 11,
			status: "completed",
			toolName: "fixture_lookup",
			payloadKind: "fixture_lookup",
			argumentsJson: { query_text: "校内通知" },
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/fixture_lookup",
		};
		const secondResult: ToolExecutionResult = {
			durationMs: 13,
			status: "completed",
			toolName: "test_lookup",
			payloadKind: "test_lookup",
			argumentsJson: { intent: "next_departure" },
			result: { outcome: "next_departure" },
			resultRef: "agent-runtime://run-sdk/tools/test_lookup",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: "done",
				lastResponseId: "resp-sdk-002",
				newItems: [
					{
						type: "tool_call_item",
						rawItem: {
							name: "fixture_lookup",
							callId: "call-fixture",
							arguments: JSON.stringify({ query_text: "校内通知" }),
						},
					},
					{
						type: "tool_call_item",
						rawItem: {
							name: "test_lookup",
							callId: "call-transport",
							arguments: JSON.stringify({ intent: "next_departure" }),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							callId: "call-transport",
							output: JSON.stringify(secondResult),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							callId: "call-fixture",
							output: JSON.stringify(firstResult),
						},
					},
				],
			}),
		});

		const result = await runner({
			input: [{ role: "user", content: "校内通知状态" }],
			instructions: "Use tools.",
			tools: [],
			requestId: "req-sdk-interleaved",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			limits,
			providerConfig,
		});

		expect(result.toolCalls.map((call) => call.result?.resultRef)).toEqual([
			firstResult.resultRef,
			secondResult.resultRef,
		]);
	});

	it("does not bind another invocation's output when an exact tool result is missing", async () => {
		const unrelatedResult: ToolExecutionResult = {
			durationMs: 9,
			status: "completed",
			toolName: "test_lookup",
			payloadKind: "test_lookup",
			argumentsJson: { intent: "next_departure" },
			result: { outcome: "next_departure" },
			resultRef: "agent-runtime://run-sdk/tools/test_lookup/call-transport",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: { kind: "answer", answerText: "done" },
				lastResponseId: "resp-sdk-missing-output",
				newItems: [
					{
						type: "tool_call_item",
						rawItem: {
							name: "fixture_lookup",
							callId: "call-fixture",
							arguments: JSON.stringify({ query_text: "校内通知" }),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							callId: "call-transport",
							output: unrelatedResult,
						},
					},
				],
			}),
		});

		await expect(
			runner({
				input: [{ role: "user", content: "查询校内服务" }],
				instructions: "Use tools.",
				tools: [],
				requestId: "req-sdk-missing-output",
				runId: "run-sdk",
				traceId: "trace-run-sdk",
				limits,
				providerConfig,
			}),
		).rejects.toThrow("has no exact result for invocation call-fixture");
	});

	it("rejects a tool result whose identity differs from its invocation", async () => {
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: { kind: "answer", answerText: "done" },
				lastResponseId: "resp-sdk-mismatched-output",
				newItems: [
					{
						type: "tool_call_item",
						rawItem: {
							name: "fixture_lookup",
							callId: "call-fixture",
							arguments: JSON.stringify({ query_text: "校内通知" }),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							callId: "call-fixture",
							output: {
								durationMs: 7,
								status: "completed",
								toolName: "test_lookup",
								payloadKind: "test_lookup",
								argumentsJson: { query_text: "校内通知" },
								result: { outcome: "resolved_current" },
								resultRef: "agent-runtime://run-sdk/tools/test_lookup",
							},
						},
					},
				],
			}),
		});

		await expect(
			runner({
				input: [{ role: "user", content: "查询校内服务" }],
				instructions: "Use tools.",
				tools: [],
				requestId: "req-sdk-mismatched-output",
				runId: "run-sdk",
				traceId: "trace-run-sdk",
				limits,
				providerConfig,
			}),
		).rejects.toThrow("result identity does not match invocation call-fixture");
	});

	it.each([
		["missing", undefined],
		["zero", 0],
		["negative", -1],
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
	])("rejects a tool result with %s duration", async (_name, durationMs) => {
		const output: Record<string, unknown> = {
			status: "completed",
			toolName: "fixture_lookup",
			payloadKind: "fixture_lookup",
			argumentsJson: { query_text: "校内通知" },
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/fixture_lookup",
		};
		if (durationMs !== undefined) {
			output.durationMs = durationMs;
		}
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: { kind: "answer", answerText: "done" },
				lastResponseId: "resp-sdk-invalid-duration",
				newItems: [
					{
						type: "tool_call_item",
						rawItem: {
							name: "fixture_lookup",
							callId: "call-fixture",
							arguments: JSON.stringify({ query_text: "校内通知" }),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: { callId: "call-fixture", output },
					},
				],
			}),
		});

		await expect(
			runner({
				input: [{ role: "user", content: "查询校内服务" }],
				instructions: "Use tools.",
				tools: [],
				requestId: "req-sdk-invalid-duration",
				runId: "run-sdk",
				traceId: "trace-run-sdk",
				limits,
				providerConfig,
			}),
		).rejects.toThrow("has no exact result for invocation call-fixture");
	});

	it("passes strict SDK tool parameter schemas derived from runtime tools", async () => {
		let toolParameterSchema: unknown;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent) => {
				toolParameterSchema = (agent.tools[0] as { parameters?: unknown }).parameters;
				return {
					finalOutput: "done",
					lastResponseId: "resp-sdk-schema",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "通知今天几点" }],
			instructions: "Use tools.",
			tools: [
				{
					name: "test_lookup",
					description: "Lookup test record schedule snapshots.",
					parameters: {
						type: "object",
						additionalProperties: false,
						required: ["query_text", "intent"],
						properties: {
							query_text: { type: "string", minLength: 1 },
							intent: {
								type: "string",
								enum: ["next_departure", "service_window"],
							},
						},
					},
					execute: async () => ({
						status: "completed",
						toolName: "test_lookup",
						payloadKind: "test_lookup",
						result: { outcome: "resolved_current" },
						resultRef: "agent-runtime://run-sdk/tools/test_lookup",
					}),
				},
			],
			requestId: "req-sdk-schema",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			limits,
			providerConfig,
		});

		expect(toolParameterSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["query_text", "intent"],
		});
	});

	it("passes run cancellation signal to the SDK runner options", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (_agent, _input, options) => {
				observedSignal = options.signal;
				return {
					finalOutput: "done",
					lastResponseId: "resp-sdk-signal",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "hi" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-signal",
			runId: "run-sdk-signal",
			traceId: "trace-run-sdk-signal",
			limits,
			providerConfig,
			signal: controller.signal,
		});

		expect(observedSignal).toBe(controller.signal);
	});

	it("disables model IO in SDK traces", async () => {
		let observedTraceIncludeSensitiveData: boolean | undefined;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (_agent, _input, options) => {
				observedTraceIncludeSensitiveData = options.traceIncludeSensitiveData;
				return {
					finalOutput: {
						kind: "answer",
						answerText: "我是校园问答助手。",
					},
					lastResponseId: "resp-sdk-debug-trace",
					newItems: [],
					trace: { traceId: "trace-debug-sdk" },
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "hi 你是谁" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-debug-trace",
			runId: "run-sdk-debug-trace",
			traceId: "trace-debug-sdk",
			limits,
			providerConfig,
		});

		expect(observedTraceIncludeSensitiveData).toBe(false);
	});

	it("streams terminal-envelope visible text before yielding the final structured SDK result", async () => {
		let observedOutputType: unknown;
		let observedTraceIncludeSensitiveData: boolean | undefined;
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async (agent, _input, options) => {
				observedOutputType = (agent as { outputType?: unknown }).outputType;
				observedTraceIncludeSensitiveData = options.traceIncludeSensitiveData;
				return {
					cancelled: false,
					completed: Promise.resolve(),
					error: null,
					finalOutput: {
						kind: "answer",
						answerText: "国家奖学金每学年评审一次。",
					},
					lastResponseId: "resp-sdk-stream",
					newItems: [],
					toTextStream: () =>
						new ReadableStream<string>({
							start(controller) {
								controller.enqueue('{"kind":"answer","answerText":"国家奖学金');
								controller.enqueue("每学年评审一次。");
								controller.enqueue('"}');
								controller.close();
							},
						}),
					usage: {
						requests: 1,
						inputTokens: 21,
						outputTokens: 13,
					},
				};
			},
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: [{ role: "user", content: "国家奖学金多久评审一次？" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream",
			runId: "run-sdk-stream",
			traceId: "trace-run-sdk-stream",
			limits,
			providerConfig,
		})) {
			events.push(event);
		}

		expect(observedOutputType).toBeDefined();
		expect(observedTraceIncludeSensitiveData).toBe(false);
		expect(events).toEqual([
			{
				accumulatedText: "国家奖学金",
				chunkIndex: 1,
				delta: "国家奖学金",
			},
			{
				accumulatedText: "国家奖学金每学年评审一次。",
				chunkIndex: 2,
				delta: "每学年评审一次。",
			},
			expect.objectContaining({
				finalOutput: "国家奖学金每学年评审一次。",
				providerResponseId: "resp-sdk-stream",
				terminalEnvelope: {
					kind: "answer",
					answerText: "国家奖学金每学年评审一次。",
				},
			}),
		]);
	});

	it("accepts empty placeholders for fields unused by the selected terminal kind", async () => {
		const transportOutput = {
			answerText: "",
			followUpQuestion: "",
			kind: "unsupported_by_evidence" as const,
			reason: "The request is not supported by the available evidence.",
		};
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async (agent) => {
				expect((agent as { outputType?: unknown }).outputType).toMatchObject({
					type: "json_schema",
					strict: true,
				});
				return {
					cancelled: false,
					completed: Promise.resolve(),
					error: null,
					finalOutput: transportOutput,
					lastResponseId: "resp-sdk-unsupported",
					newItems: [],
					toTextStream: () =>
						new ReadableStream<string>({
							start(controller) {
								controller.enqueue(JSON.stringify(transportOutput));
								controller.close();
							},
						}),
				};
			},
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: [{ role: "user", content: "What is the current campus tuition fee?" }],
			instructions: "Return unsupported_by_evidence when evidence is unavailable.",
			tools: [],
			requestId: "req-sdk-unsupported",
			runId: "run-sdk-unsupported",
			traceId: "trace-sdk-unsupported",
			limits,
			providerConfig,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{
				accumulatedText: transportOutput.reason,
				chunkIndex: 1,
				delta: transportOutput.reason,
			},
			expect.objectContaining({
				finalOutput: transportOutput.reason,
				terminalEnvelope: {
					kind: "unsupported_by_evidence",
					reason: transportOutput.reason,
				},
			}),
		]);
	});

	it("cancels the SDK text stream when the streaming consumer returns", async () => {
		let textStreamCancelled = false;
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: new Promise<void>(() => undefined),
				finalOutput: undefined,
				lastResponseId: "resp-sdk-stream-cancel",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answerText":"partial');
						},
						cancel() {
							textStreamCancelled = true;
						},
					}),
			}),
		});
		const iterator = runner({
			input: [{ role: "user", content: "stream and cancel" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream-cancel",
			runId: "run-sdk-stream-cancel",
			traceId: "trace-run-sdk-stream-cancel",
			limits,
			providerConfig,
		})[Symbol.asyncIterator]();

		expect(await iterator.next()).toMatchObject({
			done: false,
			value: { accumulatedText: "partial", chunkIndex: 1, delta: "partial" },
		});
		await iterator.return?.();

		expect(textStreamCancelled).toBe(true);
	});

	it("rejects a signal-cancelled SDK stream that closes without an SDK error", async () => {
		const controller = new AbortController();
		const cancellation = new Error("agent activity deadline reached");
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async (_agent, _input, options) => {
				let cancelled = false;
				let resolveCompleted: () => void = () => undefined;
				const completed = new Promise<void>((resolve) => {
					resolveCompleted = resolve;
				});
				const textStream = new ReadableStream<string>({
					start(streamController) {
						const abort = () => {
							cancelled = true;
							streamController.close();
							resolveCompleted();
						};
						if (options.signal?.aborted) {
							abort();
						} else {
							options.signal?.addEventListener("abort", abort, { once: true });
						}
					},
				});
				return {
					get cancelled() {
						return cancelled;
					},
					completed,
					finalOutput: undefined,
					lastResponseId: "resp-sdk-stream-aborted",
					newItems: [],
					toTextStream: () => textStream,
				};
			},
		});
		const iterator = runner({
			input: [{ role: "user", content: "stream until deadline" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream-aborted",
			runId: "run-sdk-stream-aborted",
			traceId: "trace-run-sdk-stream-aborted",
			limits,
			providerConfig,
			signal: controller.signal,
		})[Symbol.asyncIterator]();
		const pending = iterator.next();

		controller.abort(cancellation);

		await expect(pending).rejects.toBe(cancellation);
	});

	it("does not emit whitespace-only visible text deltas", async () => {
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: Promise.resolve(),
				finalOutput: {
					kind: "answer",
					answerText: "  国家奖学金每学年评审一次。",
				},
				lastResponseId: "resp-sdk-stream-whitespace",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answerText":"  ');
							controller.enqueue("国家奖学金");
							controller.enqueue('每学年评审一次。"}');
							controller.close();
						},
					}),
				usage: {
					requests: 1,
					inputTokens: 21,
					outputTokens: 13,
				},
			}),
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: [{ role: "user", content: "国家奖学金多久评审一次？" }],
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream-whitespace",
			runId: "run-sdk-stream-whitespace",
			traceId: "trace-run-sdk-stream-whitespace",
			limits,
			providerConfig,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{
				accumulatedText: "国家奖学金",
				chunkIndex: 1,
				delta: "国家奖学金",
			},
			{
				accumulatedText: "国家奖学金每学年评审一次。",
				chunkIndex: 2,
				delta: "每学年评审一次。",
			},
			expect.objectContaining({
				finalOutput: "国家奖学金每学年评审一次。",
				providerResponseId: "resp-sdk-stream-whitespace",
			}),
		]);
	});

	it("does not accept retired snake-case terminal fields", async () => {
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: Promise.resolve(),
				currentAgent: { name: "Campus primary assistant" },
				finalOutput: {
					kind: "answer",
					answer_text: "毕业最低学分要求为 160 学分。",
					follow_up_question: null,
					reason: null,
					session_update: null,
				},
				lastAgent: { name: "Campus primary assistant" },
				lastResponseId: "resp-sdk-knowledge-stream",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answer_text":"毕业最低学分要求为 160 学分。"}');
							controller.close();
						},
					}),
				usage: { requests: 1, inputTokens: 24, outputTokens: 12 },
			}),
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: [{ role: "user", content: "计算机专业毕业需要多少学分？" }],
			instructions: "Use formal campus tools when needed.",
			tools: [],
			requestId: "req-sdk-knowledge-stream",
			runId: "run-sdk-knowledge-stream",
			traceId: "trace-sdk-knowledge-stream",
			limits,
			providerConfig,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			expect.objectContaining({
				finalOutput: "[object Object]",
				providerResponseId: "resp-sdk-knowledge-stream",
				terminalEnvelope: undefined,
			}),
		]);
	});

	it("fails closed when streamed visible text drifts from the final structured output", async () => {
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: Promise.resolve(),
				finalOutput: {
					kind: "answer",
					answerText: "最终答案。",
				},
				lastResponseId: "resp-sdk-stream-drift",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answerText":"错误答案。"}');
							controller.close();
						},
					}),
				usage: {
					requests: 1,
					inputTokens: 21,
					outputTokens: 13,
				},
			}),
		});

		const events: unknown[] = [];
		await expect(async () => {
			for await (const event of runner({
				input: [{ role: "user", content: "国家奖学金多久评审一次？" }],
				instructions: "Answer directly.",
				tools: [],
				requestId: "req-sdk-stream-drift",
				runId: "run-sdk-stream-drift",
				traceId: "trace-run-sdk-stream-drift",
				limits,
				providerConfig,
			})) {
				events.push(event);
			}
		}).rejects.toThrow("streamed answer text drifted from final output");
		expect(events).toEqual([
			{
				accumulatedText: "错误答案。",
				chunkIndex: 1,
				delta: "错误答案。",
			},
		]);
	});
});
