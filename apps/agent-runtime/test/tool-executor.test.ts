import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";
import type { ToolExecutionRequest } from "../src/agent-run-contract.ts";
import { createExecutionControlToolExecutor } from "../src/tool-executor.ts";

const transportPayloadSchemaRef = schemaRef(
	"personal-memory-tool-contracts.v1",
	"PersonalMemoryRecallPayload",
);
const transportResultSchemaRef = schemaRef(
	"personal-memory-tool-contracts.v1",
	"PersonalMemoryRecallResult",
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
			toolName: "test_lookup",
			failCloseReason: "tool_executor_not_configured",
			result: {
				error: "execution-control query base URL and shared secret are required",
			},
		});
	});

	it("does not follow execution-control redirects", async () => {
		let targetRequests = 0;
		const target = createServer((_request, response) => {
			targetRequests += 1;
			response.writeHead(500, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "redirect target must not be reached" }));
		});
		await listenToolExecutorTestServer(target);
		const targetAddress = target.address() as { port: number };
		const redirect = createServer((_request, response) => {
			response.writeHead(307, {
				location: `http://127.0.0.1:${targetAddress.port}/internal/query/fixture/test`,
			});
			response.end();
		});
		await listenToolExecutorTestServer(redirect);

		try {
			const redirectAddress = redirect.address() as { port: number };
			const executor = createExecutionControlToolExecutor({
				baseUrl: `http://127.0.0.1:${redirectAddress.port}`,
				sharedSecret: "query-secret",
			});
			const request = toolRequest();
			request.tool.timeoutMs = 5_000;
			const result = await executor(request);

			expect(result).toMatchObject({
				status: "failed",
				failCloseReason: "tool_handler_redirected",
				result: { error: "execution-control query returned a redirect" },
			});
			expect(targetRequests).toBe(0);
		} finally {
			await closeToolExecutorTestServer(redirect);
			await closeToolExecutorTestServer(target);
		}
	});

	it.each([
		"/internal/../public/query",
		"/internal/query/%252e%252e/public",
		" /internal/query/knowledge/search",
	])(
		"rejects non-canonical execution-control query endpoint %s before fetching",
		async (endpoint) => {
			let fetchCalled = false;
			const executor = createExecutionControlToolExecutor({
				baseUrl: "http://execution-control:8000",
				sharedSecret: "query-secret",
				fetchImpl: async () => {
					fetchCalled = true;
					throw new Error("fetch must not be called for an absolute endpoint");
				},
			});

			const result = await executor({
				...toolRequest(),
				tool: {
					...toolRequest().tool,
					handler: {
						type: "execution_control_internal_query",
						endpoint,
					},
				},
			});

			expect(fetchCalled).toBe(false);
			expect(result).toMatchObject({
				status: "failed",
				failCloseReason: "tool_handler_invalid_endpoint",
				result: {
					error: "execution-control query endpoint must be a canonical /internal/ path",
				},
			});
		},
	);

	it("calls tool read model endpoints with internal query auth", async () => {
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

	it("passes the configured query secret without application-level trimming", async () => {
		let observedSecret: string | null = null;
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret\u00a0",
			fetchImpl: async (request, init) => {
				const normalized = request instanceof Request ? request : new Request(request, init);
				observedSecret = normalized.headers.get("x-execution-query-auth");
				return new Response(JSON.stringify({ outcome: "resolved_current" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		const result = await executor(toolRequest());

		expect(result.status).toBe("completed");
		expect(observedSecret).toBe("query-secret\u00a0");
	});

	it("preserves result envelopes from execution-control", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						outcome: "resolved_current",
						result_envelope: {
							schema_version: "test_tool_result.v1",
							tool: "test_lookup",
							tool_name: "test_lookup",
							query_kind: "test_lookup",
							outcome: "resolved_current",
							facts: {
								kind: "schedule_facts",
								result: { outcome: "resolved_current" },
							},
							source_refs: ["notice:bus-schedule-2026-04-20"],
							projection_ref: "projection:test_lookup:test",
							content_hash: "sha256:test-record-test",
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
				name: "test_lookup",
				payloadSchemaRef: transportPayloadSchemaRef,
				resultSchemaRef: transportResultSchemaRef,
				handler: {
					type: "execution_control_internal_query",
					endpoint: "/internal/query/fixture/test",
				},
			},
		});

		expect(result.status).toBe("completed");
		expect(result.result.result_envelope).toMatchObject({
			schema_version: "test_tool_result.v1",
			tool_name: "test_lookup",
			query_kind: "test_lookup",
		});
	});

	it("fails closed when tool read model returns non-2xx", async () => {
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
		expect(result.result).toEqual({ error: "execution-control query failed" });
	});

	it("fails closed when tool read model response is not JSON", async () => {
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

	it("fails closed when tool read model request throws", async () => {
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
		expect(result.result).not.toHaveProperty("detail");
	});

	it("classifies the tool request timeout as a transient query failure", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async (_request, init) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal;
					if (signal?.aborted) {
						reject(signal.reason);
						return;
					}
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		});
		const request = toolRequest();
		request.tool.timeoutMs = 10;

		const result = await executor(request);

		expect(result).toMatchObject({
			status: "failed",
			failCloseReason: "transient_internal_query_failed",
			result: { error: "execution-control query timed out" },
		});
	});

	it("does not misclassify a response body timeout as invalid JSON", async () => {
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async (_request, init) => {
				const signal = init?.signal;
				return new Response(
					new ReadableStream({
						start(controller) {
							if (signal?.aborted) {
								controller.error(signal.reason);
								return;
							}
							signal?.addEventListener("abort", () => controller.error(signal.reason), {
								once: true,
							});
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});
		const request = toolRequest();
		request.tool.timeoutMs = 10;

		const result = await executor(request);

		expect(result).toMatchObject({
			status: "failed",
			failCloseReason: "transient_internal_query_failed",
			result: { error: "execution-control query timed out" },
		});
	});

	it("passes run cancellation signal into tool read model fetch timeout envelope", async () => {
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

	it("propagates parent run cancellation instead of converting it to a tool failure", async () => {
		const controller = new AbortController();
		const cancellation = new Error("agent activity cancelled");
		let fetchStarted: () => void = () => undefined;
		const started = new Promise<void>((resolve) => {
			fetchStarted = resolve;
		});
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async (_request, init) => {
				const signal = init?.signal;
				fetchStarted();
				return new Promise<Response>((_resolve, reject) => {
					if (signal?.aborted) {
						reject(signal.reason);
						return;
					}
					signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
				});
			},
		});
		const result = executor({ ...toolRequest(), signal: controller.signal });
		await started;

		controller.abort(cancellation);

		await expect(result).rejects.toBe(cancellation);
	});

	it("rejects a tool response that races with parent run cancellation", async () => {
		const controller = new AbortController();
		const cancellation = new Error("agent activity deadline reached");
		const executor = createExecutionControlToolExecutor({
			baseUrl: "http://execution-control:8000",
			sharedSecret: "query-secret",
			fetchImpl: async () => {
				controller.abort(cancellation);
				return new Response(JSON.stringify({ outcome: "resolved_current" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			},
		});

		await expect(executor({ ...toolRequest(), signal: controller.signal })).rejects.toBe(
			cancellation,
		);
	});
});

function toolRequest(): ToolExecutionRequest {
	return {
		activityAttempt: 1,
		runId: "run-tool-executor",
		traceId: "trace-tool-executor",
		argumentsJson: { query_text: "通知下一班几点", intent: "next_departure" },
		tool: {
			name: "test_lookup",
			description: "Lookup transport schedule.",
			exposure: "model_visible",
			readOnly: true,
			requiresApproval: false,
			payloadSchemaRef: transportPayloadSchemaRef,
			resultSchemaRef: transportResultSchemaRef,
			handler: {
				type: "execution_control_internal_query",
				endpoint: "/internal/query/fixture/test",
			},
			timeoutMs: 1000,
			resultProjectionPolicy: "bounded_json",
		},
	};
}

function schemaRef(schemaName: string, definitionName: string): string {
	return `https://muc.wiki/campus-agent/schemas/${schemaName}.schema.json#/$defs/${definitionName}`;
}

function listenToolExecutorTestServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function closeToolExecutorTestServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
		server.closeAllConnections();
	});
}
