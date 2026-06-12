import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";

const catalog: ToolCatalog = {
	schemaVersion: "tool-catalog.v1",
	catalogVersion: "test",
	tools: [
		{
			name: "knowledge_query",
			capability: "knowledge",
			description: "Route this turn to the governed knowledge workflow.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: "manual.KnowledgeQuerySignalPayload",
			resultSchemaRef: "manual.KnowledgeQuerySignalResult",
			handler: {
				type: "workflow_signal",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
		{
			name: "transport_schedule_lookup",
			capability: "campus_services",
			description: "Lookup campus shuttle schedule snapshots.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: "manual.TransportScheduleLookupPayload",
			resultSchemaRef: "manual.TransportScheduleLookupResult",
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/transport-schedule",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
	],
};

describe("primary agent runtime", () => {
	it("returns a no-tool final answer without synthetic capability routing", async () => {
		const runner: AgentRunner = async ({ input }) => ({
			finalOutput: `我是校园问答助手。收到：${input}`,
			providerResponseId: "resp_1",
			toolCalls: [],
			traceRef: "trace_1",
			usage: { inputTokens: 12, outputTokens: 8 },
		});
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			runId: "run-no-tool",
			conversationId: "conversation-1",
			turnId: "turn-1",
			traceId: "trace-1",
			input: "hi 你是谁",
			visibleCapabilities: ["campus_services"],
		});

		expect(result.status).toBe("completed");
		expect(result.finalOutput).toContain("校园问答助手");
		expect(result.selectedTools).toEqual([]);
	});

	it("passes visible SDK tools to the runner and records selected tool results", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({
				query_text: "校车今天几点",
				intent: "next_departure",
			});
			return {
				finalOutput: "校车查询完成。",
				providerResponseId: "resp_2",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { intent: "next_departure" },
						result: toolResult,
					},
				],
				traceRef: "trace_2",
				usage: { inputTokens: 20, outputTokens: 10 },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ tool, argumentsJson }) => ({
				status: "completed",
				toolName: tool.name,
				capability: tool.capability,
				payloadKind: tool.name,
				result: {
					outcome: "resolved_current",
					echo: argumentsJson,
				},
				resultRef: "agent-runtime://run-tool/tools/transport_schedule_lookup",
			}),
		});

		const result = await runtime.run({
			runId: "run-tool",
			conversationId: "conversation-1",
			turnId: "turn-2",
			traceId: "trace-2",
			input: "校车今天几点",
			visibleCapabilities: ["campus_services"],
		});

		expect(result.selectedTools).toEqual(["transport_schedule_lookup"]);
		expect(result.toolResults[0]?.resultRef).toBe(
			"agent-runtime://run-tool/tools/transport_schedule_lookup",
		);
		expect(result.usage.outputTokens).toBe(10);
	});

	it("projects knowledge workflow-signal selections without requiring a final answer", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({ query_text: "学籍管理规定是什么" });
			return {
				finalOutput: "",
				providerResponseId: "resp_knowledge_signal",
				toolCalls: [
					{
						name: "knowledge_query",
						argumentsSummary: { query_text: "学籍管理规定是什么" },
						result: toolResult,
					},
				],
				traceRef: "trace_knowledge_signal",
				usage: { inputTokens: 18, outputTokens: 4 },
			};
		};
		const runtime = createPrimaryAgentRuntime({ catalog, runner });

		const result = await runtime.run({
			runId: "run-knowledge-signal",
			conversationId: "conversation-1",
			turnId: "turn-4",
			traceId: "trace-4",
			input: "学籍管理规定是什么",
			visibleCapabilities: ["knowledge"],
		});

		expect(result.status).toBe("completed");
		expect(result.finalOutput).toBe("");
		expect(result.selectedTools).toEqual(["knowledge_query"]);
		expect(result.terminalReason).toBe("tool_selected");
		expect(result.toolResults).toEqual([
			{
				status: "completed",
				toolName: "knowledge_query",
				capability: "knowledge",
				payloadKind: "knowledge_query",
				result: { workflow_signal: "knowledge_query" },
				resultRef: "agent-runtime://run-knowledge-signal/tools/knowledge_query",
			},
		]);
	});

	it("fails the primary agent run when a selected tool fails closed", async () => {
		const runner: AgentRunner = async ({ tools }) => {
			const toolResult = await tools[0]?.execute({
				query_text: "校车今天几点",
				intent: "next_departure",
			});
			return {
				finalOutput: "校车查询失败。",
				providerResponseId: "resp_failed_tool",
				toolCalls: [
					{
						name: "transport_schedule_lookup",
						argumentsSummary: { intent: "next_departure" },
						result: toolResult,
					},
				],
				traceRef: "trace_failed_tool",
				usage: { inputTokens: 20, outputTokens: 10 },
			};
		};
		const runtime = createPrimaryAgentRuntime({
			catalog,
			runner,
			toolExecutor: async ({ tool }) => ({
				status: "failed",
				toolName: tool.name,
				capability: tool.capability,
				payloadKind: tool.name,
				result: {
					error: "source truth unavailable",
				},
				resultRef: "agent-runtime://run-tool/tools/transport_schedule_lookup/failed",
				failCloseReason: "source_truth_unavailable",
			}),
		});

		const result = await runtime.run({
			runId: "run-tool-failed",
			conversationId: "conversation-1",
			turnId: "turn-3",
			traceId: "trace-3",
			input: "校车今天几点",
			visibleCapabilities: ["campus_services"],
		});

		expect(result.status).toBe("failed");
		expect(result.terminalReason).toBe("agent_runtime_failed");
		expect(result.finalOutput).toBe("");
		expect(result.toolResults[0]?.failCloseReason).toBe("source_truth_unavailable");
	});
});
