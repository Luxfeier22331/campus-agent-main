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

const limits = {
	agentDeadlineMs: 90_000,
	contextCharLimit: 16_000,
	currentInputCharLimit: 8_000,
	maxKnowledgeSearches: 3,
	maxOutputTokens: 2_048,
	maxTurns: 6,
};

function knowledgeQueryParameters() {
	return {
		type: "object" as const,
		additionalProperties: false as const,
		properties: {
			query_text: { type: "string" },
		},
		required: ["query_text"],
	};
}

function knowledgeSearchParameters() {
	return {
		type: "object" as const,
		additionalProperties: false as const,
		properties: {
			query_text: { type: "string" },
			target: { type: "string" },
			include_history: { type: "boolean" },
		},
		required: ["query_text", "target", "include_history"],
	};
}

describe("OpenAI Agents SDK runner adapter", () => {
	it("uses an official handoff and lets the knowledge agent select search targets", async () => {
		let observedToolContext: unknown;
		let observedToolArguments: unknown;
		let observedToolChoice: unknown;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent, _input, options) => {
				observedToolChoice = agent.modelSettings.toolChoice;
				expect(agent.modelSettings.maxTokens).toBe(2_048);
				expect(options.maxTurns).toBe(6);
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
					}),
				);
				expect(runContext.context.knowledge).toEqual({
					queryText: "2024 版计算机专业培养方案的毕业学分要求",
				});
				await expect(knowledgeAgent?.getSystemPrompt(runContext)).resolves.toContain(
					"- curriculum: 培养方案",
				);
				expect(knowledgeAgent?.tools.map((item: { name: string }) => item.name)).toEqual([
					"knowledge_search",
				]);
				expect(knowledgeAgent?.modelSettings.maxTokens).toBe(2_048);
				await expect(knowledgeAgent?.getSystemPrompt(runContext)).resolves.not.toContain(
					"2024 版计算机专业培养方案的毕业学分要求",
				);

				const searchTool = knowledgeAgent?.tools[0];
				if (searchTool?.type !== "function") {
					throw new Error("knowledge_search function tool is required");
				}
				const searchArguments = {
					query_text: "毕业学分要求",
					target: "curriculum",
					include_history: true,
				};
				await searchTool.invoke(runContext, JSON.stringify(searchArguments), {
					toolCall: {
						type: "function_call",
						callId: "call-knowledge-search-1",
						name: "knowledge_search",
						arguments: JSON.stringify(searchArguments),
					},
				});
				return {
					finalOutput: {
						kind: "unsupported_by_evidence",
						answer_text: "当前证据不足，无法确认。",
						evidence_refs: [],
						follow_up_question: null,
						reason: "no_evidence",
						session_update: null,
					},
					lastAgent: { name: "Campus knowledge agent" },
					lastResponseId: "resp-sdk-handoff",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "2024 版计算机专业培养方案的毕业学分要求是什么" }],
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
			knowledgeTargets: [
				{
					target: "curriculum",
					description: "培养方案",
				},
			],
			toolChoice: "knowledge_query",
			requestId: "req-sdk-handoff",
			runId: "run-sdk-handoff",
			traceId: "trace-sdk-handoff",
			limits,
			providerConfig,
		});

		expect(observedToolChoice).toBe("knowledge_query");
		expect(observedToolArguments).toEqual({
			query_text: "毕业学分要求",
			target: "curriculum",
			include_history: true,
		});
		expect(observedToolContext).toMatchObject({
			invocationId: "call-knowledge-search-1",
			searchOrdinal: 1,
		});
	});

	it("reserves at most three knowledge searches and suppresses duplicate queries", async () => {
		const executedOrdinals: number[] = [];
		let duplicateResult: unknown;
		let fourthResult: unknown;
		const runner = createOpenAIAgentsRunner({
			runSdk: async (agent, _input, options) => {
				const handoff = agent.handoffs[0];
				if (!(handoff && "onInvokeHandoff" in handoff)) {
					throw new Error("knowledge_query handoff is required");
				}
				const runContext = new RunContext(options.context);
				const knowledgeAgent = await handoff.onInvokeHandoff(
					runContext,
					JSON.stringify({ query_text: "跨域制度与培养方案问题" }),
				);
				const searchTool = knowledgeAgent?.tools[0];
				if (searchTool?.type !== "function") {
					throw new Error("knowledge_search function tool is required");
				}
				const outputs = await Promise.all(
					Array.from({ length: 4 }, (_, index) => {
						const argumentsJson = {
							query_text: index === 1 ? "  检索问题 1  " : `检索问题 ${index + 1}`,
							target: index < 2 ? "student_rules" : "curriculum",
							include_history: false,
						};
						return searchTool.invoke(runContext, JSON.stringify(argumentsJson), {
							toolCall: {
								type: "function_call",
								callId: `call-budget-${index + 1}`,
								name: "knowledge_search",
								arguments: JSON.stringify(argumentsJson),
							},
						});
					}),
				);
				duplicateResult = outputs[1];
				fourthResult = outputs[3];
				return {
					finalOutput: {
						kind: "unsupported_by_evidence",
						answerText: "当前证据不足。",
						reason: "insufficient_evidence",
					},
					lastResponseId: "resp-sdk-budget",
					newItems: [],
				};
			},
		});

		await runner({
			input: [{ role: "user", content: "跨域制度与培养方案问题" }],
			instructions: "Use the knowledge handoff.",
			tools: [],
			knowledgeAgent: {
				handoff: {
					name: "knowledge_query",
					description: "Delegate governed campus knowledge questions.",
					parameters: knowledgeQueryParameters(),
				},
				instructions: "Search published evidence before answering.",
				searchTool: {
					name: "knowledge_search",
					description: "Search one published target.",
					parameters: knowledgeSearchParameters(),
					execute: async (_argumentsJson, context) => {
						executedOrdinals.push(context?.searchOrdinal ?? 0);
						await Promise.resolve();
						return {
							status: "completed",
							toolName: "knowledge_search",
							payloadKind: "knowledge_search",
							result: { outcome: "no_evidence", evidence: [] },
							resultRef: `projection://runs/run-sdk-budget/knowledge/search/${context?.searchOrdinal}`,
						};
					},
				},
			},
			knowledgeTargets: [
				{ target: "student_rules", description: "学生管理规定" },
				{ target: "curriculum", description: "培养方案" },
			],
			requestId: "req-sdk-budget",
			runId: "run-sdk-budget",
			traceId: "trace-sdk-budget",
			limits,
			providerConfig,
		});

		expect(executedOrdinals).toEqual([1, 3]);
		expect(duplicateResult).toMatchObject({
			status: "completed",
			result: { outcome: "duplicate_query", evidence: [] },
		});
		expect(fourthResult).toMatchObject({
			status: "completed",
			result: {
				outcome: "search_budget_exhausted",
				evidence: [],
			},
		});
	});

	it("projects the handoff publicly and keeps knowledge searches internal", async () => {
		const searchResult: ToolExecutionResult = {
			status: "completed",
			toolName: "knowledge_search",
			payloadKind: "knowledge_search",
			argumentsJson: {
				query_text: "学分要求",
				target: "curriculum",
				include_history: false,
			},
			result: { outcome: "found", evidence: [] },
			resultRef: "projection://runs/run-sdk-trajectory/knowledge/search/1",
		};
		const runner = createOpenAIAgentsRunner({
			runSdk: async () => ({
				finalOutput: { kind: "answer", answerText: "以培养方案为准。" },
				lastResponseId: "resp-sdk-trajectory",
				newItems: [
					{
						type: "handoff_call_item",
						rawItem: {
							name: "knowledge_query",
							callId: "handoff-1",
							arguments: JSON.stringify({ query_text: "毕业学分要求" }),
						},
					},
					{
						type: "tool_call_item",
						rawItem: {
							name: "knowledge_search",
							callId: "search-1",
							arguments: JSON.stringify(searchResult.argumentsJson),
						},
					},
					{
						type: "tool_call_output_item",
						rawItem: {
							callId: "search-1",
							output: searchResult,
						},
					},
				],
			}),
		});

		const result = await runner({
			input: [{ role: "user", content: "毕业学分要求是什么？" }],
			instructions: "Use the knowledge handoff.",
			tools: [],
			requestId: "req-sdk-trajectory",
			runId: "run-sdk-trajectory",
			traceId: "trace-sdk-trajectory",
			limits,
			providerConfig,
		});

		expect(result.toolCalls.map((call) => call.name)).toEqual(["knowledge_query"]);
		expect(result.internalToolCalls?.map((call) => call.name)).toEqual(["knowledge_search"]);
		expect(result.internalToolCalls?.[0]?.result).toEqual(searchResult);
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
			status: "completed",
			toolName: "transport_schedule_lookup",
			payloadKind: "transport_schedule_lookup",
			result: { outcome: "resolved_current" },
			resultRef: "agent-runtime://run-sdk/tools/transport_schedule_lookup",
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
				};
			},
		});

		const result = await runner({
			input: [{ role: "user", content: "校车今天几点" }],
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
			limits,
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
			input: [{ role: "user", content: "校内服务状态和班车" }],
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
			input: [{ role: "user", content: "校车今天几点" }],
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

	it("exports model IO with product correlation metadata", async () => {
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

		expect(observedTraceIncludeSensitiveData).toBe(true);
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

	it("withholds knowledge-agent output until durable finalization", async () => {
		const runner = createStreamingOpenAIAgentsRunner({
			runSdkStream: async () => ({
				completed: Promise.resolve(),
				currentAgent: { name: "Campus knowledge agent" },
				finalOutput: {
					kind: "answer",
					answer_text: "毕业最低学分要求为 160 学分。",
					evidence_refs: ["evidence://sha256/example"],
					follow_up_question: null,
					reason: null,
					session_update: null,
				},
				lastAgent: { name: "Campus knowledge agent" },
				lastResponseId: "resp-sdk-knowledge-stream",
				newItems: [],
				toTextStream: () =>
					new ReadableStream<string>({
						start(controller) {
							controller.enqueue('{"kind":"answer","answer_text":"毕业最低学分要求为 160 学分。"}');
							controller.close();
						},
					}),
				usage: { inputTokens: 24, outputTokens: 12 },
			}),
		});

		const events: unknown[] = [];
		for await (const event of runner({
			input: [{ role: "user", content: "计算机专业毕业需要多少学分？" }],
			instructions: "Use the knowledge handoff.",
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
