import type { AssistantMessageItem, ModelProvider } from "@openai/agents";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
	AgentRunnerAnswerDelta,
	AgentRunnerInput,
	AgentRunnerResult,
	AgentRunnerSolveDecision,
	SdkToolRuntime,
} from "../src/agent-run-contract.ts";
import { failedRunnerResult } from "../src/runner-failure.ts";
import { AgentRuntimeError } from "../src/runtime-errors.ts";
import { createOpenAIAgentsRunner, createStreamingOpenAIAgentsRunner } from "../src/sdk-runner.ts";
import { solveSdkOutputSchema } from "../src/workflow-runtime.ts";

import { memoryRecallTool, recalledMemory } from "./helpers/memory-recall.ts";

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
	maxFunctionToolCalls: 10,
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
		source_kind: "document",
		text: `result ${citationStart + offset}`,
		title: `Result ${citationStart + offset}`,
	}));
}

function input(
	tools: SdkToolRuntime[] = [],
	overrides: Partial<AgentRunnerInput> = {},
): AgentRunnerInput {
	return {
		allowWebSearch: false,
		citationStart: 1,
		input: [{ role: "user", content: "查询校内信息" }],
		instructions: "Answer directly.",
		operation: "execute_step",
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
	it("passes formatted recall to the model and records the same tool result", async () => {
		const model = new ScriptedModel([
			[functionCall("personal_memory_recall", { query: "偏好" }, { callId: "recall" })],
			[assistantMessage("已找到偏好。")],
		]);
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input([memoryRecallTool()]));
		expect(result.toolResults[0]).toMatchObject({
			toolName: "personal_memory_recall",
			result: recalledMemory,
		});
		const followup = JSON.stringify(model.calls[1]);
		expect(followup).toContain("memory_text");
		expect(followup).toContain("喜欢安静😀");
		expect(followup).not.toContain("context_char_budget");
		model.assertComplete();
	});

	it("unwraps a non-streaming answer with answer before outcome", async () => {
		const model = new ScriptedModel([
			[assistantMessage(JSON.stringify({ result: { answer: "你好", outcome: "answer" } }))],
		]);
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([], {
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		);
		expect(model.calls[0]).toMatchObject({
			streamed: true,
			request: {
				outputType: "text",
				modelSettings: { providerData: { text: { format: { type: "json_object" } } } },
			},
		});
		expect(result).toMatchObject({
			finalOutput: "你好",
			structuredOutput: { outcome: "answer", answer: "你好" },
		});
	});
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
		for (const toolResult of result.toolResults) {
			expect(toolResult.startedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/u));
			expect(toolResult.completedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/u));
			expect(Date.parse(toolResult.completedAt ?? "")).toBeGreaterThanOrEqual(
				Date.parse(toolResult.startedAt ?? ""),
			);
		}
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
						return {
							status: "failed",
							result: { error: "timeout" },
							failure: { code: "campus_search_timeout", operation: "tool.campus_search" },
						};
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

	it("continues targeted retrieval beyond ten citations", async () => {
		const model = new ScriptedModel([
			[functionCall("campus_search", { search_query: "一" }, { callId: "search-1" })],
			[functionCall("campus_search", { search_query: "二" }, { callId: "search-2" })],
			[functionCall("campus_search", { search_query: "三" }, { callId: "search-3" })],
			[assistantMessage("完成。")],
		]);
		let downstreamCalls = 0;
		const observations: Array<{ invocationId: string; phase: string; failureCode?: string }> = [];
		const searchTool = campusSearchTool(async (_arguments, context) => {
			expect(context?.excludedResultRefs).toEqual(
				searchResults(1, downstreamCalls * 5).map((item) => item.result_ref),
			);
			downstreamCalls += 1;
			const citationStart = context?.citationStart ?? 0;
			return {
				status: "completed",
				result: { outcome: "matched", results: searchResults(citationStart, 5) },
			};
		});
		searchTool.observe = async (_arguments, invocationId, observation) => {
			observations.push({ invocationId, ...observation });
		};
		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input([searchTool]));

		expect(downstreamCalls).toBe(3);
		expect(model.calls).toHaveLength(4);
		expect(result.failure).toBeUndefined();
		expect(result.usage.modelRequestCount).toBe(4);
		expect(result.providerResponseId).not.toBe("");
		expect(observations.filter((item) => item.invocationId === "search-3")).toEqual([
			{ invocationId: "search-3", phase: "queued" },
		]);
		expect(result.toolResults.at(-1)).toMatchObject({
			status: "completed",
			invocationId: "search-3",
			result: {
				results: expect.arrayContaining([expect.objectContaining({ citation_index: 11 })]),
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
			})(input([lookupTool(execute)], { limits: { ...limits, maxFunctionToolCalls: 1 } })),
		).resolves.toMatchObject({
			failure: { code: "tool_call_budget_exhausted" },
			toolResults: [expect.objectContaining({ invocationId: "call-1", status: "completed" })],
		});
	});

	it("streams SDK text from every model turn and keeps final output canonical", async () => {
		const model = new ScriptedModel([
			[
				assistantMessage("我先查询。"),
				functionCall("test_lookup", { query_text: "通知" }, { callId: "call-1" }),
			],
			[assistantMessage("最终答案。")],
		]);
		const events: Array<AgentRunnerAnswerDelta | AgentRunnerResult | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input([lookupTool()], { operation: "synthesize" }))) {
			events.push(event);
		}

		expect(events.slice(0, -1)).toEqual([{ delta: "我先查询。" }, { delta: "最终答案。" }]);
		expect(events.at(-1)).toMatchObject({
			finalOutput: "最终答案。",
			toolResults: [{ toolName: "test_lookup" }],
		});
	});

	it("retains answer-started when a streamed draft fails before completion", async () => {
		const model = new ScriptedModel([
			[
				assistantMessage("未完成草稿"),
				functionCall("test_lookup", { query_text: "通知" }, { callId: "call-1" }),
			],
		]);
		const events: Array<AgentRunnerAnswerDelta | AgentRunnerResult | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input([lookupTool()], { operation: "synthesize", limits: { ...limits, maxTurns: 1 } }))) {
			events.push(event);
		}
		expect(events[0]).toEqual({ delta: "未完成草稿" });
		expect(events.at(-1)).toMatchObject({
			answerStarted: true,
			finalOutput: "",
			failure: { code: "max_turns_exceeded" },
			toolResults: [{ invocationId: "call-1" }],
		});
	});

	it("streams a structured solve answer only after emitting its decision", async () => {
		const answer = '中文\n"校园"';
		const model = new ScriptedModel([
			[assistantMessage(JSON.stringify({ result: { outcome: "answer", answer } }))],
		]);
		const events: Array<AgentRunnerAnswerDelta | AgentRunnerResult | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([], {
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		)) {
			events.push(event);
		}

		expect(events).toEqual([
			{ solveOutcome: "answer" },
			{ delta: answer },
			expect.objectContaining({
				finalOutput: answer,
				structuredOutput: { outcome: "answer", answer },
			}),
		]);
		model.assertComplete();
	});

	it("streams a structured solve plan without exposing plan JSON as answer text", async () => {
		const plan = {
			outcome: "plan",
			plan: {
				schemaVersion: "task_plan.v1",
				goal: "查询奖学金",
				steps: [
					{
						id: "step.scholarship",
						objective: "查找奖学金通知",
						candidateSources: ["campus_search"],
						dependsOn: [],
					},
				],
			},
		};
		const model = new ScriptedModel([[assistantMessage(JSON.stringify({ result: plan }))]]);
		const events: Array<AgentRunnerAnswerDelta | AgentRunnerResult | AgentRunnerSolveDecision> = [];
		for await (const event of createStreamingOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(
			input([], {
				operation: "solve",
				outputSchema: { name: "solve", schema: z.toJSONSchema(solveSdkOutputSchema) },
			}),
		)) {
			events.push(event);
		}

		expect(events[0]).toEqual({ solveOutcome: "plan" });
		expect(events.slice(1)).toEqual([
			expect.objectContaining({
				finalOutput: "",
				structuredOutput: plan,
			}),
		]);
		expect(events.some((event) => "delta" in event)).toBe(false);
		model.assertComplete();
	});

	it("adds hosted Web Search only when the model capability is admitted", async () => {
		const responsesModel = new ScriptedModel([[assistantMessage("已完成。")]]);
		await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(responsesModel),
		})(
			input([], {
				allowWebSearch: true,
				providerConfig: { ...providerConfig, hostedWebSearch: true },
			}),
		);
		expect(responsesModel.firstCall?.request.tools).toEqual([
			expect.objectContaining({ type: "hosted_tool", name: "web_search" }),
		]);

		const chatModel = new ScriptedModel([[assistantMessage("已完成。")]]);
		await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(chatModel),
		})(
			input([], {
				providerConfig: {
					...providerConfig,
					hostedWebSearch: false,
					transport: "chat_completions",
				},
			}),
		);
		expect(chatModel.firstCall?.request.tools).toEqual([]);
	});

	it.each([
		[{ title: "" }, "missing_field", "title"],
		[{ url: "bad-url" }, "invalid_url", "url"],
		[{ start_index: -1 }, "invalid_offset", undefined],
		[{ end_index: 99 }, "span_out_of_bounds", undefined],
		[{ start_index: "1" }, "invalid_offset", "start_index"],
	] as const)("reports the rejected citation rule %s", async (patch, reason, field) => {
		const model = new ScriptedModel([
			[
				assistantMessageWithAnnotations("😀学校", [
					{
						type: "url_citation",
						url: "https://www.muc.edu.cn/",
						title: "学校",
						start_index: 0,
						end_index: 2,
						...patch,
					},
				]),
			],
		]);
		await expect(
			createOpenAIAgentsRunner({ model: "gpt-test", modelProvider: providerFor(model) })(input()),
		).rejects.toMatchObject({
			code: "citation_validation_failed",
			failure: {
				reason,
				citation: {
					schema_version: 1,
					validation_stage: "provider_annotation",
					item_index: 0,
					text_length: 4,
					offset_unit: "utf16_code_unit",
					...(field ? { field } : {}),
				},
			},
		});
	});

	it("returns native Web Search citations without local function results", async () => {
		const model = new ScriptedModel([
			[
				{
					type: "hosted_tool_call",
					name: "web_search_call",
					status: "completed",
					providerData: { type: "web_search_call" },
				},
				assistantMessageWithAnnotations("😀本校地址见这里。", [
					{
						end_index: 9,
						start_index: 7,
						title: "学校官网",
						type: "url_citation",
						url: "https://www.muc.edu.cn/contact#address",
					},
				]),
			],
		]);

		const result = await createOpenAIAgentsRunner({
			model: "gpt-test",
			modelProvider: providerFor(model),
		})(input());

		expect(result).toMatchObject({
			toolResults: [],
			webEvidence: [
				{
					excerpt: "这里",
					title: "学校官网",
					url: "https://www.muc.edu.cn/contact#address",
				},
			],
			webSearchUsed: true,
		});
	});
});

function assistantMessageWithAnnotations(
	text: string,
	annotations: Record<string, unknown>[],
): AssistantMessageItem {
	return {
		type: "message",
		role: "assistant",
		status: "completed",
		phase: "final_answer",
		content: [
			{
				type: "output_text",
				text,
				providerData: { annotations },
			},
		],
	};
}

it("retains citation diagnosis when a started answer becomes a failed result", () => {
	const citation = {
		schema_version: 1,
		validation_stage: "provider_annotation",
		start: 0,
		end: 9,
		text_length: 4,
		offset_unit: "utf16_code_unit",
	} as const;
	const result = failedRunnerResult(
		new AgentRuntimeError("citation_validation_failed", "invalid citation", {
			reason: "span_out_of_bounds",
			citation,
		}),
		{
			operation: "solve",
			input: [],
			instructions: "",
			limits,
			tools: [],
			requestId: "citation-failed-result",
			providerConfig,
			allowWebSearch: true,
			citationStart: 1,
		},
		{
			answerStarted: true,
			finalOutput: "partial",
			providerResponseId: "",
			toolResults: [],
			usage: { modelRequestCount: 1, inputTokens: 0, outputTokens: 0, usageObserved: true },
		},
	);
	expect(result.finalOutput).toBe("");
	expect(result.failure).toMatchObject({
		code: "citation_validation_failed",
		reason: "span_out_of_bounds",
		citation,
	});
});
