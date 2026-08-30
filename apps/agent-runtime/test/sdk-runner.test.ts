import type { ModelProvider } from "@openai/agents";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { describe, expect, it } from "vitest";
import type {
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	AgentRunnerResult,
	SdkToolRuntime,
} from "../src/agent-run-contract.ts";
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
		properties: { query_text: { type: "string" } },
		required: ["query_text"],
	};
}

function lookupTool(execute?: SdkToolRuntime["execute"]): SdkToolRuntime {
	return {
		name: "test_lookup",
		description: "Lookup test records.",
		parameters: queryParameters(),
		execute:
			execute ??
			(async (argumentsJson) => ({
				status: "completed",
				result: { arguments: argumentsJson },
			})),
	};
}

function campusSearchTool(execute: SdkToolRuntime["execute"]): SdkToolRuntime {
	return {
		name: "campus_search",
		description: "Search current campus documents.",
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: { search_query: { type: "string" } },
			required: ["search_query"],
		},
		execute,
	};
}

function searchResults(citationStart: number, count: number) {
	return Array.from({ length: count }, (_, offset) => ({
		citation_index: citationStart + offset,
		result_ref: `result://${String(citationStart + offset).padStart(64, "0")}`,
	}));
}

function input(
	tools: SdkToolRuntime[] = [],
	overrides: Partial<AgentRunnerInput> = {},
): AgentRunnerInput {
	return {
		input: [{ role: "user", content: "查询校内信息" }],
		instructions: "Answer directly.",
		tools,
		requestId: "req-sdk",
		limits,
		providerConfig,
		...overrides,
	};
}

function providerFor(model: ScriptedModel): ModelProvider {
	return {
		async getModel() {
			return model;
		},
	};
}

describe("OpenAI Agents SDK runner adapter", () => {
	it("uses the SDK text output, response ID, and usage", async () => {
		const model = new ScriptedModel([[assistantMessage("我是校园问答助手。")]]);
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input());

		expect(result).toMatchObject({
			finalOutput: "我是校园问答助手。",
			providerResponseId: "scripted-response-1",
			toolResults: [],
			usage: { modelRequestCount: 1, usageObserved: true },
		});
		model.assertComplete();
	});

	it("allows the same tool to be called repeatedly within the total budget", async () => {
		const model = new ScriptedModel([
			[functionCall("test_lookup", { query_text: "第一次" }, { callId: "call-1" })],
			[functionCall("test_lookup", { query_text: "第二次" }, { callId: "call-2" })],
			[assistantMessage("查询完成。")],
		]);
		const invocations: Array<{ arguments: Record<string, unknown>; invocationId?: string }> = [];
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([
				lookupTool(async (argumentsJson, context) => {
					invocations.push({
						arguments: argumentsJson,
						...(context?.invocationId ? { invocationId: context.invocationId } : {}),
					});
					return { status: "completed", result: { query: argumentsJson.query_text } };
				}),
			]),
		);

		expect(invocations).toEqual([
			{ arguments: { query_text: "第一次" }, invocationId: "call-1" },
			{ arguments: { query_text: "第二次" }, invocationId: "call-2" },
		]);
		expect(result.toolResults.map((item) => item.argumentsJson)).toEqual([
			{ query_text: "第一次" },
			{ query_text: "第二次" },
		]);
		expect(result.toolResults.every((item) => item.durationMs > 0)).toBe(true);
	});

	it("correlates concurrently completed calls by call ID and preserves model order", async () => {
		const model = new ScriptedModel([
			[
				functionCall("test_lookup", { query_text: "慢" }, { callId: "call-slow" }),
				functionCall("test_lookup", { query_text: "快" }, { callId: "call-fast" }),
			],
			[assistantMessage("完成。")],
		]);
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([
				lookupTool(async (argumentsJson) => {
					if (argumentsJson.query_text === "慢") {
						await new Promise((resolve) => setTimeout(resolve, 5));
					}
					return { status: "completed", result: { value: argumentsJson.query_text } };
				}),
			]),
		);

		expect(result.toolResults.map((item) => item.result.value)).toEqual(["慢", "快"]);
	});

	it("numbers campus search results continuously across calls", async () => {
		const model = new ScriptedModel([
			[functionCall("campus_search", { search_query: "第一次" }, { callId: "search-1" })],
			[functionCall("campus_search", { search_query: "第二次" }, { callId: "search-2" })],
			[assistantMessage("完成 [1][4]。")],
		]);
		const starts: number[] = [];
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([
				campusSearchTool(async (_arguments, context) => {
					const citationStart = context?.citationStart ?? 0;
					starts.push(citationStart);
					const count = starts.length === 1 ? 3 : 2;
					return {
						status: "completed",
						result: { outcome: "matched", results: searchResults(citationStart, count) },
					};
				}),
			]),
		);

		expect(starts).toEqual([1, 4]);
		expect(result.toolResults.flatMap((item) => item.result.results as object[])).toHaveLength(5);
	});

	it("serializes same-turn campus searches in model order", async () => {
		const model = new ScriptedModel([
			[
				functionCall("campus_search", { search_query: "慢" }, { callId: "search-slow" }),
				functionCall("campus_search", { search_query: "快" }, { callId: "search-fast" }),
			],
			[assistantMessage("完成。")],
		]);
		const events: string[] = [];
		await createOpenAIAgentsRunner({ model: "gpt-test", modelProvider: providerFor(model) })(
			input([
				campusSearchTool(async (argumentsJson, context) => {
					const query = String(argumentsJson.search_query);
					events.push(`start:${query}:${context?.citationStart}`);
					if (query === "慢") {
						await new Promise((resolve) => setTimeout(resolve, 5));
					}
					events.push(`finish:${query}`);
					return {
						status: "completed",
						result: {
							outcome: "matched",
							results: searchResults(context?.citationStart ?? 0, 1),
						},
					};
				}),
			]),
		);

		expect(events).toEqual(["start:慢:1", "finish:慢", "start:快:2", "finish:快"]);
	});

	it("does not advance campus citation numbering for no-match or failed calls", async () => {
		const model = new ScriptedModel([
			[functionCall("campus_search", { search_query: "无结果" }, { callId: "search-none" })],
			[functionCall("campus_search", { search_query: "失败" }, { callId: "search-failed" })],
			[functionCall("campus_search", { search_query: "命中" }, { callId: "search-match" })],
			[assistantMessage("完成 [1]。")],
		]);
		const starts: number[] = [];
		await createOpenAIAgentsRunner({ model: "gpt-test", modelProvider: providerFor(model) })(
			input([
				campusSearchTool(async (argumentsJson, context) => {
					const citationStart = context?.citationStart ?? 0;
					starts.push(citationStart);
					if (argumentsJson.search_query === "失败") {
						return { status: "failed", result: { error: "unavailable" } };
					}
					const matched = argumentsJson.search_query === "命中";
					return {
						status: "completed",
						result: {
							outcome: matched ? "matched" : "no_match",
							results: matched ? searchResults(citationStart, 1) : [],
						},
					};
				}),
			]),
		);

		expect(starts).toEqual([1, 1, 1]);
	});

	it("caps campus search results at ten per run", async () => {
		const model = new ScriptedModel([
			[functionCall("campus_search", { search_query: "一" }, { callId: "search-1" })],
			[functionCall("campus_search", { search_query: "二" }, { callId: "search-2" })],
			[functionCall("campus_search", { search_query: "三" }, { callId: "search-3" })],
			[assistantMessage("完成。")],
		]);
		let downstreamCalls = 0;
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([
				campusSearchTool(async (_arguments, context) => {
					downstreamCalls += 1;
					const citationStart = context?.citationStart ?? 0;
					return {
						status: "completed",
						result: { outcome: "matched", results: searchResults(citationStart, 5) },
					};
				}),
			]),
		);

		expect(downstreamCalls).toBe(2);
		expect(result.toolResults.at(-1)).toMatchObject({
			status: "failed",
			invocationId: "search-3",
			failure: {
				code: "campus_search_result_budget_exhausted",
				operation: "tool.campus_search",
			},
		});
	});

	it("fails the run instead of returning a synthetic tool result when the budget is exhausted", async () => {
		const model = new ScriptedModel([
			[functionCall("test_lookup", { query_text: "第一次" }, { callId: "call-1" })],
			[functionCall("test_lookup", { query_text: "第二次" }, { callId: "call-2" })],
		]);
		const execute = async () => ({ status: "completed" as const, result: { outcome: "ok" } });

		await expect(
			createOpenAIAgentsRunner({
				model: "gpt-test",
				modelProvider: providerFor(model),
			})(input([lookupTool(execute)], { limits: { ...limits, maxToolCalls: 1 } })),
		).rejects.toThrow("tool call budget is exhausted");
	});

	it("streams SDK text from every model turn and keeps final output canonical", async () => {
		const model = new ScriptedModel([
			[
				assistantMessage("我先查询。"),
				functionCall("test_lookup", { query_text: "通知" }, { callId: "call-1" }),
			],
			[assistantMessage("最终答案。")],
		]);
		const events: Array<AgentRunnerAnswerDelta | AgentRunnerResult> = [];
		for await (const event of createStreamingOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input([lookupTool()]))) {
			events.push(event);
		}

		expect(events.slice(0, -1)).toEqual([{ delta: "我先查询。" }, { delta: "最终答案。" }]);
		expect(events.at(-1)).toMatchObject({
			finalOutput: "最终答案。",
			toolResults: [{ toolName: "test_lookup" }],
		});
	});
});
