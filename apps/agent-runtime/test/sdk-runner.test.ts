import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "../src/primary-agent.ts";
import { createOpenAIAgentsRunner } from "../src/sdk-runner.ts";

const providerConfig = {
	apiKey: "test-provider-key",
	baseUrl: "https://provider.example/v1",
	model: "gpt-test",
	provider: "openai",
	transport: "responses",
};

describe("OpenAI Agents SDK runner adapter", () => {
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
			runId: "run-sdk-provider",
			traceId: "trace-run-sdk-provider",
			providerConfig,
		});

		expect(observedModel).toBe("gpt-agent");
		expect(observedModelProvider).toBe(modelProvider);
	});

	it("projects tool calls, trace refs, provider response IDs, and usage from SDK run results", async () => {
		const toolResult: ToolExecutionResult = {
			status: "completed",
			toolName: "transport_schedule_lookup",
			capability: "campus_services",
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
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			providerConfig,
		});

		expect(result.finalOutput).toBe("final:校车今天几点");
		expect(result.providerResponseId).toBe("resp-sdk-001");
		expect(result.traceRef).toBe("trace://openai-agents/trace-sdk-001");
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
			toolName: "service_status_lookup",
			capability: "campus_services",
			payloadKind: "service_status_lookup",
			result: { outcome: "open" },
			resultRef: "agent-runtime://run-sdk/tools/service_status_lookup",
		};
		const secondResult: ToolExecutionResult = {
			status: "completed",
			toolName: "transport_schedule_lookup",
			capability: "campus_services",
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
							name: "service_status_lookup",
							callId: "call-service",
							arguments: JSON.stringify({ service_key: "library" }),
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
							callId: "call-service",
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
						required: ["query_text"],
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
						capability: "campus_services",
						payloadKind: "transport_schedule_lookup",
						result: { outcome: "resolved_current" },
						resultRef: "agent-runtime://run-sdk/tools/transport_schedule_lookup",
					}),
				},
			],
			runId: "run-sdk",
			traceId: "trace-run-sdk",
			providerConfig,
		});

		expect(toolParameterSchema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["query_text"],
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
			runId: "run-sdk-signal",
			traceId: "trace-run-sdk-signal",
			providerConfig,
			signal: controller.signal,
		});

		expect(observedSignal).toBe(controller.signal);
	});
});
