import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OperatorQueryService } from "../src/modules/operator-query";
import {
	createCampusPrincipal,
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryRuntimeHealthSuite(): void {
	describe("GET /api/operator/runtime/health", () => {
		it("returns operator-safe execution runtime health with Temporal pollers", async () => {
			const principal = createOperatorPrincipal();
			const runtimeHealth = {
				asOf: "2026-06-16T08:00:00.000Z",
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
							healthy: true,
							name: "campus-agent.activity.knowledge",
							pollers: 2,
							type: "activity",
						},
					],
					workerId: "staging:workflow:01",
					workflowTaskQueue: "campus-agent.workflow",
				},
			};
			const service = createOperatorQueryServiceMock({
				getRuntimeHealth: vi.fn().mockResolvedValue(runtimeHealth),
			}) as OperatorQueryService;
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/runtime/health"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual(runtimeHealth);
			expect(service.getRuntimeHealth).toHaveBeenCalledWith({ principal });
		});

		it("fails closed for non-operator principals", async () => {
			const service = createOperatorQueryServiceMock();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createCampusPrincipal()),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/runtime/health"),
			);

			expect(response.status).toBe(403);
			expect(service.getRuntimeHealth).not.toHaveBeenCalled();
		});
	});
}
