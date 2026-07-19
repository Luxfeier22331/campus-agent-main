// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { probeExecutionControlReady } from "../src/modules/integration/execution-control";

describe("execution control readiness adapter", () => {
	it("uses private binding instead of injected fetch for staging readiness probes", async () => {
		const overrideFetch = vi.fn().mockResolvedValue(new Response(null, { status: 599 }));
		const privateFetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					run_projection_store: { configured: true, healthy: true, last_error: "" },
					temporal_runtime: {
						configured: true,
						healthy: true,
						namespace: "campus-agent-staging",
						task_queue: "campus-agent.workflow",
						task_queue_pollers: [],
						task_queues: ["campus-agent.workflow"],
						worker_id: "staging:execution-control:01",
					},
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);

		await expect(
			probeExecutionControlReady(
				{
					APP_API_ENVIRONMENT: "staging",
					EXECUTION_CONTROL_PRIVATE: { fetch: privateFetch },
					EXECUTION_CONTROL_PRIVATE_ORIGIN: "http://execution-control.internal:8000",
					APP_API_EXECUTION_SHARED_SECRET: "shared-secret",
				},
				{ fetchImplementation: overrideFetch },
			),
		).resolves.toMatchObject({
			executionRuntime: { status: "ready" },
		});
		expect(privateFetch).toHaveBeenCalledTimes(1);
		expect(overrideFetch).not.toHaveBeenCalled();
	});
});
