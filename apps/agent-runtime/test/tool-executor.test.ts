import { describe, expect, it } from "vitest";
import type { ToolExecutionRequest } from "../src/primary-agent.ts";
import { createExecutionControlToolExecutor } from "../src/tool-executor.ts";

const transportPayloadSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupPayload",
);
const transportResultSchemaRef = schemaRef(
	"campus-services-tool-contracts.v1",
	"TransportScheduleLookupResult",
);

describe("execution-control tool executor", () => {
	it("fails closed when execution-control query config is missing", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "",
			sharedSecret: "",
			fetchImpl: async () => {
				throw new Error("fetch must not be called");
			},
		});

		const result = await executor(toolRequest());

		expect(result).toMatchObject({
			status: "failed",
			toolName: "transport_schedule_lookup",
			failCloseReason: "tool_executor_not_configured",
			result: {
				error: "execution-control query base URL and shared secret are required",
			},
		});
	});

	it("calls structured query endpoints with internal query auth", async () => {
		const requests: Request[] = [];
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async (request, init) => {
				requests.push(request instanceof Request ? request : new Request(request, init));
				return new Response(JSON.stringify({ outcome: "resolved_current" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		const result = await executor(toolRequest());

		expect(result.status).toBe("completed");
		expect(requests).toHaveLength(1);
		expect(requests[0]?.headers.get("x-execution-query-auth")).toBe("query-secret");
		expect(requests[0]?.headers.get("authorization")).toBeNull();
	});

	it("preserves campus services result envelopes from execution-control", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						outcome: "resolved_current",
						result_envelope: {
							schema_version: "campus_services_tool_result.v1",
							capability: "campus_services",
							tool_name: "transport_schedule_lookup",
							query_kind: "transport_schedule",
							outcome: "resolved_current",
							facts: {
								kind: "schedule_facts",
								result: { outcome: "resolved_current" },
							},
							source_refs: ["notice:bus-schedule-2026-04-20"],
							projection_ref: "projection:campus_services:transport_schedule:test",
							content_hash: "sha256:transport-schedule-test",
							clarification_options: [],
						},
					}),
					{
						status: 200,
						headers: { "content-type": "application/json" },
					},
				),
		});

		const result = await executor({
			...toolRequest(),
			tool: {
				...toolRequest().tool,
				name: "transport_schedule_lookup",
				payloadSchemaRef: transportPayloadSchemaRef,
				resultSchemaRef: transportResultSchemaRef,
				handler: {
					type: "execution_control_internal_query",
					endpoint: "/internal/query/campus-services/transport-schedule",
				},
			},
		});

		expect(result.status).toBe("completed");
		expect(result.result.result_envelope).toMatchObject({
			schema_version: "campus_services_tool_result.v1",
			tool_name: "transport_schedule_lookup",
			query_kind: "transport_schedule",
		});
	});

	it("fails closed when structured query returns non-2xx", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: { code: "source_truth_unavailable" } }), {
					status: 503,
					headers: { "content-type": "application/json" },
				}),
		});

		const result = await executor(toolRequest());

		expect(result.status).toBe("failed");
		expect(result.failCloseReason).toBe("tool_handler_failed");
		expect(result.result).toEqual({ error: { code: "source_truth_unavailable" } });
	});

	it("fails closed when structured query response is not JSON", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () => new Response("not-json", { status: 200 }),
		});

		const result = await executor(toolRequest());

		expect(result.status).toBe("failed");
		expect(result.failCloseReason).toBe("tool_handler_invalid_response");
		expect(result.result.error).toBe("execution-control query returned invalid JSON");
	});

	it("fails closed when structured query request throws", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () => {
				throw new Error("network down");
			},
		});

		const result = await executor(toolRequest());

		expect(result.status).toBe("failed");
		expect(result.failCloseReason).toBe("transient_internal_query_failed");
		expect(result.result.error).toBe("execution-control query request failed");
		expect(result.result.detail).toBe("network down");
	});

	it("passes run cancellation signal into structured query fetch timeout envelope", async () => {
		const controller = new AbortController();
		let observedSignal: AbortSignal | undefined;
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async (_request, init) => {
				observedSignal = init?.signal ?? undefined;
				return new Response(JSON.stringify({ outcome: "resolved_current" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		const result = await executor({ ...toolRequest(), signal: controller.signal });

		expect(result.status).toBe("completed");
		expect(observedSignal).toBeDefined();
		expect(observedSignal).not.toBe(controller.signal);
		expect(observedSignal?.aborted).toBe(false);

		controller.abort();

		expect(observedSignal?.aborted).toBe(true);
	});
});

function toolRequest(): ToolExecutionRequest {
	return {
		runId: "run-tool-executor",
		traceId: "trace-tool-executor",
		argumentsJson: { query_text: "校车下一班几点", intent: "next_departure" },
		tool: {
			name: "transport_schedule_lookup",
			capability: "campus_services",
			description: "Lookup transport schedule.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: transportPayloadSchemaRef,
			resultSchemaRef: transportResultSchemaRef,
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/transport-schedule",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
	};
}

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}
