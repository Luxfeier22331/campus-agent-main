import { describe, expect, it } from "vitest";
import type { ToolExecutionRequest } from "../src/primary-agent.ts";
import { createExecutionControlToolExecutor } from "../src/tool-executor.ts";

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
			toolName: "service_status_lookup",
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
		argumentsJson: { subject_query: "校车" },
		tool: {
			name: "service_status_lookup",
			capability: "campus_services",
			description: "Lookup service status.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: "manual.ServiceStatusLookupPayload",
			resultSchemaRef: "manual.ServiceStatusLookupResult",
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/campus-services/service-status",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
	};
}
