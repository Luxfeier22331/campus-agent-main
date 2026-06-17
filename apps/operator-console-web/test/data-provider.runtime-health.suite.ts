import { expect, it, vi } from "vitest";

import { operatorConsoleDataProvider } from "../src/panel/data-provider";
import { createJsonResponse } from "./data-provider.test-support";

export function registerDataProviderRuntimeHealthSuite() {
	it("loads operator runtime health from the app-api operator seam", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			createJsonResponse({
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
					requiredTaskQueues: ["campus-agent.workflow"],
					taskQueueGate: "pollers_required",
					taskQueuePollers: [
						{
							healthy: true,
							name: "campus-agent.workflow",
							pollers: 1,
							type: "workflow",
						},
					],
					workerId: "staging:workflow:01",
					workflowTaskQueue: "campus-agent.workflow",
				},
			}),
		);

		await expect(operatorConsoleDataProvider.getOperatorRuntimeHealth()).resolves.toMatchObject({
			data: {
				executionRuntime: {
					checks: {
						temporalRuntime: "ready",
					},
					status: "ready",
				},
				temporalRuntime: {
					namespace: "campus-agent-staging",
					taskQueuePollers: [
						{
							name: "campus-agent.workflow",
							pollers: 1,
						},
					],
					workflowTaskQueue: "campus-agent.workflow",
				},
			},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/operator/runtime/health",
			expect.objectContaining({
				headers: {
					accept: "application/json",
				},
				method: "GET",
			}),
		);
	});
}
