import { RunContext } from "@openai/agents";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "../src/primary-agent.ts";
import { createOpenAIAgentsRunner, createStreamingOpenAIAgentsRunner } from "../src/sdk-runner.ts";

const providerConfig = {
	apiKey: "test-provider-key",
	baseUrl: "https://provider.example/v1",
	model: "gpt-test",
	provider: "openai",
	transport: "responses",
};

function knowledgeQueryParameters() {
	return {
		type: "object" as const,
		additionalProperties: false as const,
		properties: {
			query_text: { type: "string" },
			scope: { type: "string" },
			version_query: {
				type: ["object", "null"],
				additionalProperties: false,
				properties: {
					mode: { type: "string", enum: ["current", "historical", "as_of", "compare"] },
					as_of: { type: ["string", "null"] },
					version_id: { type: ["string", "null"] },
					compare_to_version_id: { type: ["string", "null"] },
				},
				required: ["mode", "as_of", "version_id", "compare_to_version_id"],
			},
		},
		required: ["query_text", "scope", "version_query"],
	};
}

function knowledgeSearchParameters() {
	return {
		type: "object" as const,
		additionalProperties: false as const,
		properties: { query_text: { type: "string" } },
		required: ["query_text"],
	};
}

describe("OpenAI Agents SDK runner adapter", () => {
	it("uses an official handoff and binds knowledge_search to the admitted run context", async () => {
		let observedToolContext: unknown;
		let observedToolArguments: unknown;
		let observedToolChoice: unknown;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent, _input, options) => {
				observedToolChoice = agent.modelSettings.toolChoice;
				const knowledgeHandoff = agent.handoffs[0];
				if (!(knowledgeHandoff && "toolName" in knowledgeHandoff)) {
					throw new Error("knowledge_query handoff is required");
				}
				expect(knowledgeHandoff?.toolName).toBe("knowledge_query");
				expect(knowledgeHandoff?.agentName).toBe("Campus knowledge agent");

				const runContext = new RunContext(options.context);
				const knowledgeAgent = await knowledgeHandoff?.onInvokeHandoff(
					runContext,
					JSON.stringify({
						query_text: "2024 版计算机专业培养方案的毕业学分要求",
						scope: "curriculum",
						version_query: {
							mode: "historical",
							as_of: null,
							version_id: "2024",
							compare_to_version_id: null,
						},
					}),
				);
				expect(runContext.context.knowledge).toEqual({
					queryText: "2024 版计算机专业培养方案的毕业学分要求",
					scope: "curriculum",
					versionQuery: {
						mode: "historical",
						as_of: null,
						version_id: "2024",
						compare_to_version_id: null,
					},
				});
				expect(knowledgeAgent?.tools.map((item: { name: string }) => item.name)).toEqual([
					"knowledge_search",
				]);

				const searchTool = knowledgeAgent?.tools[0];
				if (searchTool?.type !== "function") {
					throw new Error("knowledge_search function tool is required");
				}
				await searchTool.invoke(runContext, JSON.stringify({ query_text: "毕业学分要求" }), {
					toolCall: {
						type: "function_call",
						callId: "call-knowledge-search-1",
						name: "knowledge_search",
						arguments: JSON.stringify({ query_text: "毕业学分要求" }),
					},
				});
				return {
					finalOutput: {
						kind: "unsupported_by_evidence",
						answerText: "当前证据不足，无法确认。",
						reason: "no_evidence",
					},
					lastResponseId: "resp-sdk-handoff",
					newItems: [],
				};
			},
		});

		await runner({
			input: "2024 版计算机专业培养方案的毕业学分要求是什么",
			instructions: "Use the knowledge handoff.",
			tools: [],
			knowledgeAgent: {
				handoff: {
					name: "knowledge_query",
					description: "Delegate governed campus knowledge questions.",
					parameters: knowledgeQueryParameters(),
				},
				instructions: "Search admitted evidence before answering.",
				searchTool: {
					name: "knowledge_search",
					description: "Search admitted campus knowledge.",
					parameters: knowledgeSearchParameters(),
					execute: async (argumentsJson, context) => {
						observedToolArguments = argumentsJson;
						observedToolContext = context;
						return {
							status: "completed",
							toolName: "knowledge_search",
							payloadKind: "knowledge_search",
							result: {
								outcome: "no_evidence",
								evidence: [],
							},
							resultRef: "projection://runs/run-sdk-handoff/knowledge/search/1",
						};
					},
				},
			},
			allowedKnowledgeScopes: [
				{
					scope: "curriculum",
					description: "培养方案",
					allowedQueryModes: ["current", "historical", "as_of", "compare"],
				},
			],
			toolChoice: "knowledge_query",
			requestId: "req-sdk-handoff",
			runId: "run-sdk-handoff",
			traceId: "trace-sdk-handoff",
			providerConfig,
		});

		expect(observedToolChoice).toBe("knowledge_query");
		expect(observedToolArguments).toEqual({ query_text: "毕业学分要求" });
		expect(observedToolContext).toMatchObject({
			invocationId: "call-knowledge-search-1",
			knowledge: {
				scope: "curriculum",
				versionQuery: { mode: "historical", version_id: "2024" },
			},
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
				return {
					finalOutput: "done",
					lastResponseId: "resp-sdk-provider",
					newItems: [],
				};
			},
		});

		await runner({
			input: "hi",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-provider",
			runId: "run-sdk-provider",
			traceId: "trace-run-sdk-provider",
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
			input: "hi 你是谁",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-structured-output",
			runId: "run-sdk-structured-output",
			traceId: "trace-run-sdk-structured-output",
			providerConfig,
		});

		expect(observedOutputType).toBeDefined();
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
			input: "hi 你是谁",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-empty-follow-up",
			runId: "run-sdk-empty-follow-up",
			traceId: "trace-run-sdk-empty-follow-up",
			providerConfig,
		});

		expect((result as { terminalEnvelope?: unknown }).terminalEnvelope).toEqual({
			kind: "answer",
			answerText: "我是校园问答助手。",
		});
		expect(result.finalOutput).toBe("我是校园问答助手。");
	});

	it("projects tool calls, trace refs, provider response IDs, and usage from SDK run results", async () => {
		const toolResult: ToolExecutionResult = {
			status: "completed",
			toolName: "transport_schedule_lookup",
			payloadKind: "transport_schedule_lookup",
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/transport_schedule_lookup",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async (_agent, input) => ({
				finalOutput: `final:${String(input)}`,
				trace: { traceId: "trace-sdk-001" },
				lastResponseId: "resp-sdk-001",
				usage: {
					inputTokens: 21,
					outputTokens: 13,
					cachedInputTokens: 5,
				},
				newItems: [
					{
						type: "tool_call_item",
						rawItem: {
							name: "transport_schedule_lookup",
							arguments: { intent: "next_departure" },
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							output: toolResult,
						},
					},
				],
			}),
		});

		const result = await runner({
			input: "校车今天几点",
			instructions: "Answer with tools when needed.",
			tools: [
				{
					name: "transport_schedule_lookup",
					description: "Lookup campus shuttle schedule snapshots.",
					execute: async () => toolResult,
				},
			],
			requestId: "req-sdk",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			providerConfig,
		});

		expect(result.finalOutput).toBe("final:校车今天几点");
		expect(result.providerResponseId).toBe("resp-sdk-001");
		expect(result.toolCalls).toEqual([
			{
				name: "transport_schedule_lookup",
				argumentsSummary: { intent: "next_departure" },
				result: toolResult,
			},
		]);
		expect(result.usage).toEqual({
			inputTokens: 21,
			outputTokens: 13,
			cachedInputTokens: 5,
		});
	});

	it("matches SDK tool outputs by call ID when output items are interleaved", async () => {
		const firstResult: ToolExecutionResult = {
			status: "completed",
			toolName: "fixture_lookup",
			payloadKind: "fixture_lookup",
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/fixture_lookup",
		};
		const secondResult: ToolExecutionResult = {
			status: "completed",
			toolName: "transport_schedule_lookup",
			payloadKind: "transport_schedule_lookup",
			result: { outcome: "next_departure" },
			resultRef: "agent-runtime://run-sdk/tools/transport_schedule_lookup",
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
							arguments: JSON.stringify({ query_text: "班车通知" }),
						},
					},
					{
						type: "tool_call_item",
						rawItem: {
							name: "transport_schedule_lookup",
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
			input: "校内服务状态和班车",
			instructions: "Use tools.",
			tools: [],
			requestId: "req-sdk-interleaved",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			providerConfig,
		});

		expect(result.toolCalls.map((call) => call.result?.resultRef)).toEqual([
			firstResult.resultRef,
			secondResult.resultRef,
		]);
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
			input: "校车今天几点",
			instructions: "Use tools.",
			tools: [
				{
					name: "transport_schedule_lookup",
					description: "Lookup campus shuttle schedule snapshots.",
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
						toolName: "transport_schedule_lookup",
						payloadKind: "transport_schedule_lookup",
						result: { outcome: "resolved_current" },
						resultRef: "agent-runtime://run-sdk/tools/transport_schedule_lookup",
					}),
				},
			],
			requestId: "req-sdk-schema",
			runId: "run-sdk",
			traceId: "trace-run-sdk",
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
			input: "hi",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-signal",
			runId: "run-sdk-signal",
			traceId: "trace-run-sdk-signal",
			providerConfig,
			signal: controller.signal,
		});

		expect(observedSignal).toBe(controller.signal);
	});

	it("keeps SDK sensitive tracing disabled and attaches safe trace metadata", async () => {
		let observedTraceIncludeSensitiveData: boolean | undefined;
		let observedTraceMetadata: Record<string, string> | undefined;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (_agent, _input, options) => {
				observedTraceIncludeSensitiveData = options.traceIncludeSensitiveData;
				observedTraceMetadata = options.traceMetadata;
				return {
					finalOutput: {
						kind: "answer",
						answerText: "我是校园问答助手。",
					},
					lastResponseId: "resp-sdk-debug-trace",
					newItems: [],
				};
			},
		});

		await runner({
			input: "hi 你是谁",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-debug-trace",
			runId: "run-sdk-debug-trace",
			traceId: "trace-debug-sdk",
			providerConfig,
		});

		expect(observedTraceIncludeSensitiveData).toBe(false);
		expect(observedTraceMetadata).toEqual({
			"campus.trace_id": "trace-debug-sdk",
			"request.id": "req-sdk-debug-trace",
			"run.id": "run-sdk-debug-trace",
		});
	});

	it("streams terminal-envelope visible text before yielding the final structured SDK result", async () => {
		let observedOutputType: unknown;
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async (agent) => {
				observedOutputType = (agent as { outputType?: unknown }).outputType;
				return {
					completed: Promise.resolve(),
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
						inputTokens: 21,
						outputTokens: 13,
					},
				};
			},
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: "国家奖学金多久评审一次？",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream",
			runId: "run-sdk-stream",
			traceId: "trace-run-sdk-stream",
			providerConfig,
		})) {
			events.push(event);
		}

		expect(observedOutputType).toBeDefined();
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
					inputTokens: 21,
					outputTokens: 13,
				},
			}),
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: "国家奖学金多久评审一次？",
			instructions: "Answer directly.",
			tools: [],
			requestId: "req-sdk-stream-whitespace",
			runId: "run-sdk-stream-whitespace",
			traceId: "trace-run-sdk-stream-whitespace",
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

	it("withholds knowledge-agent output until durable finalization", async () => {
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: Promise.resolve(),
				currentAgent: { name: "Campus knowledge agent" },
				finalOutput: {
					kind: "answer",
					answerText: "毕业最低学分要求为 160 学分。",
					evidenceRefs: ["evidence://sha256/example"],
					resolvedScope: "curriculum",
				},
				lastAgent: { name: "Campus knowledge agent" },
				lastResponseId: "resp-sdk-knowledge-stream",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answerText":"毕业最低学分要求为 160 学分。"}');
							controller.close();
						},
					}),
				usage: { inputTokens: 24, outputTokens: 12 },
			}),
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: "计算机专业毕业需要多少学分？",
			instructions: "Use the knowledge handoff.",
			tools: [],
			requestId: "req-sdk-knowledge-stream",
			runId: "run-sdk-knowledge-stream",
			traceId: "trace-sdk-knowledge-stream",
			providerConfig,
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			expect.objectContaining({
				finalOutput: "毕业最低学分要求为 160 学分。",
				providerResponseId: "resp-sdk-knowledge-stream",
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
					inputTokens: 21,
					outputTokens: 13,
				},
			}),
		});

		const events: unknown[] = [];
		await expect(async () => {
			for await (const event of runner({
				input: "国家奖学金多久评审一次？",
				instructions: "Answer directly.",
				tools: [],
				requestId: "req-sdk-stream-drift",
				runId: "run-sdk-stream-drift",
				traceId: "trace-run-sdk-stream-drift",
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
