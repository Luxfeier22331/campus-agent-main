// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	probeExecutionControlOperatorRuntimeHealth,
	probeExecutionControlReady,
} from "../src/modules/integration/execution-control";

describe("execution control runtime health adapter", () => {
	it("preserves Temporal poller readiness as operator-safe runtime health", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					run_projection_store: {
						configured: true,
						healthy: true,
						last_error: "",
					},
					status: "ready",
					temporal_runtime: {
						configured: true,
						healthy: true,
						last_error: "",
						namespace: "campus-agent-staging",
						task_queue: "campus-agent.workflow",
						task_queue_gate: "pollers_required",
						task_queue_pollers: [
							{
								healthy: true,
								name: "campus-agent.workflow",
								pollers: 1,
								type: "workflow",
							},
							{
								healthy: false,
								name: "campus-agent.activity.knowledge",
								pollers: 0,
								type: "activity",
							},
						],
						task_queues: [
							"campus-agent.workflow",
							"campus-agent.activity.core",
							"campus-agent.activity.knowledge",
							"campus-agent.activity.core",
						],
						worker_id: "staging:workflow:01",
					},
				}),
				{ status: 200 },
			),
		);

		const readiness = await probeExecutionControlReady(
			{
				EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
				EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
			},
			{ fetchImplementation },
		);

		expect(readiness.runtimeHealth).toEqual({
			asOf: expect.any(String),
			executionRuntime: {
				blockers: {},
				checks: {
					runProjectionStore: "ready",
					temporalRuntime: "ready",
				},
				status: "ready",
			},
			runProjectionStore: {
				configured: true,
				healthy: true,
				lastError: null,
			},
			status: "ready",
			temporalRuntime: {
				configured: true,
				healthy: true,
				lastError: null,
				namespace: "campus-agent-staging",
				requiredTaskQueues: [
					"campus-agent.workflow",
					"campus-agent.activity.core",
					"campus-agent.activity.knowledge",
					"campus-agent.activity.core",
				],
				taskQueueGate: "pollers_required",
				taskQueuePollers: [
					{
						healthy: true,
						name: "campus-agent.workflow",
						pollers: 1,
						type: "workflow",
					},
					{
						healthy: false,
						name: "campus-agent.activity.knowledge",
						pollers: 0,
						type: "activity",
					},
				],
				workerId: "staging:workflow:01",
				workflowTaskQueue: "campus-agent.workflow",
			},
		});
	});

	it("projects execution-control degraded readyz payload for operator runtime health", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					run_projection_store: {
						configured: true,
						healthy: true,
						last_error: "",
					},
					status: "degraded",
					temporal_runtime: {
						configured: true,
						healthy: false,
						last_error: "temporal required task queues are incomplete",
						namespace: "campus-agent-staging",
						task_queue: "campus-agent.workflow",
						task_queue_gate: "pollers_required",
						task_queue_pollers: [
							{
								healthy: true,
								name: "campus-agent.workflow",
								pollers: 1,
								type: "workflow",
							},
							{
								healthy: false,
								name: "campus-agent.activity.core",
								pollers: 0,
								type: "activity",
							},
						],
						task_queues: ["campus-agent.workflow", "campus-agent.activity.core"],
						worker_id: "staging:execution-control:01",
					},
				}),
				{
					headers: {
						"content-type": "application/json",
					},
					status: 503,
				},
			),
		);

		await expect(
			probeExecutionControlOperatorRuntimeHealth(
				{
					EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
					EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
				},
				{ fetchImplementation },
			),
		).resolves.toMatchObject({
			executionRuntime: {
				blockers: {
					temporalRuntime: "temporal_runtime is not configured and healthy",
				},
				checks: {
					runProjectionStore: "ready",
					temporalRuntime: "not_ready",
				},
				status: "blocked",
			},
			status: "degraded",
			temporalRuntime: {
				lastError: "temporal required task queues are incomplete",
				taskQueuePollers: [
					{
						healthy: true,
						name: "campus-agent.workflow",
						pollers: 1,
					},
					{
						healthy: false,
						name: "campus-agent.activity.core",
						pollers: 0,
					},
				],
			},
		});
	});

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
					EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
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
