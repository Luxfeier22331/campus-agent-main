import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAgentRuntimeHandler } from "../src/http-server.ts";
import type { AgentRunner } from "../src/primary-agent.ts";
import { createPrimaryAgentRuntime } from "../src/primary-agent.ts";
import type { ToolCatalog } from "../src/tool-catalog.ts";

const catalog: ToolCatalog = {
	schemaVersion: "tool-catalog.v1",
	catalogVersion: "test",
	tools: [
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

		expect(response.status).toBe(200);
		const body = (await response.json()) as { final_output?: string; selected_tools?: string[] };
		expect(body.final_output).toBe("我是校园问答助手。");
		expect(body.selected_tools).toEqual([]);
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
						providerResponseId: "resp_signal",
						sdkTraceRef: "trace_signal",
						selectedTools: [],
						toolResults: [],
						terminalReason: "answer_completed",
						usage: { inputTokens: 1, outputTokens: 1 },
					};
				},
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(validRunBody()),
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
					capability: tool.capability,
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
				body: JSON.stringify(validRunBody()),
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
			},
		});

		const response = await handler(
			new Request("http://agent-runtime/internal/agent-runs", {
				method: "POST",
				headers: { authorization: "Bearer secret" },
				body: JSON.stringify(validRunBody()),
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

describe("agent runtime server env contract", () => {
	it("uses AGENT_RUNTIME-prefixed env names for execution-control internal query config", () => {
		const source = readFileSync(
			fileURLToPath(new URL("../src/server.ts", import.meta.url)),
			"utf8",
		);

		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL");
		expect(source).toContain("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_BASE_URL");
		expect(source).not.toContain("process.env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
	});
});

const noToolRunner: AgentRunner = async () => ({
	finalOutput: "我是校园问答助手。",
	providerResponseId: "resp_test",
	toolCalls: [],
	traceRef: "trace_test",
	usage: { inputTokens: 1, outputTokens: 1 },
});

function validRunBody(): Record<string, unknown> {
	return {
		run_id: "run-1",
		conversation_id: "conversation-1",
		turn_id: "turn-1",
		trace_id: "trace-1",
		input: "hi 你是谁",
		visible_capabilities: ["campus_services"],
	};
}
