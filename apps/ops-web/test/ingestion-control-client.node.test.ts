// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createIngestionControlClientFromEnv,
	IngestionControlResponseError,
	IngestionControlUnavailableError,
} from "../src/server/ingestion-control-client";

describe("ingestion-control client", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("queries and validates only through the fixed ingestion-control operation", async () => {
		const fetchFn = vi.fn(async (url: string) =>
			Response.json(
				url.endsWith("/retry")
					? {
							retry_of_task_id: "retry:task-001",
							task_id: "retry:task-002",
							workflow_id: "ingestion/retry:task-002",
							workflow_run_id: "temporal-run-002",
						}
					: {
							errorCode: null,
							lastAttemptAt: "2026-07-16T00:00:00.000Z",
							lastOutcome: "SUCCESS",
							lastSuccessAt: "2026-07-16T00:00:03.000Z",
							nextRunAt: "2026-07-16T00:30:00.000Z",
							noticeProbeSucceeded: true,
							portalSessionEstablished: true,
							scheduleState: "ACTIVE",
							serviceTicketIssued: true,
						},
			),
		);
		vi.stubGlobal("fetch", fetchFn);
		const client = createIngestionControlClientFromEnv({
			OPS_WEB_INTERNAL_TOKEN: "ops-token",
			OPS_WEB_INGESTION_CONTROL_URL: "http://ingestion-control:8000/",
		});

		await expect(client.getStatus()).resolves.toMatchObject({ lastOutcome: "SUCCESS" });
		await client.validate("ops@example.test");
		await client.retryTask("retry:task-001", "ops@example.test");
		expect(fetchFn).toHaveBeenNthCalledWith(
			1,
			"http://ingestion-control:8000/internal/ingestion/operations/internal-portal-auth-maintenance",
			expect.objectContaining({
				headers: { authorization: "Bearer ops-token" },
				method: "GET",
			}),
		);
		expect(fetchFn).toHaveBeenNthCalledWith(
			2,
			"http://ingestion-control:8000/internal/ingestion/operations/internal-portal-auth-maintenance/validate",
			expect.objectContaining({
				headers: expect.objectContaining({ "x-operator-id": "ops@example.test" }),
				method: "POST",
			}),
		);
		expect(fetchFn).toHaveBeenNthCalledWith(
			3,
			"http://ingestion-control:8000/internal/ingestion/operations/tasks/retry%3Atask-001/retry",
			expect.objectContaining({
				headers: expect.objectContaining({ "x-operator-id": "ops@example.test" }),
				method: "POST",
			}),
		);
	});

	it("keeps reads available but refuses validation when runtime config is absent", async () => {
		const client = createIngestionControlClientFromEnv({});

		await expect(client.getStatus()).resolves.toMatchObject({ scheduleState: "UNAVAILABLE" });
		await expect(client.validate("ops@example.test")).rejects.toBeInstanceOf(
			IngestionControlUnavailableError,
		);
	});

	it("preserves ingestion-control conflict responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ error: "ingestion_task_still_running" }, { status: 409 })),
		);
		const client = createIngestionControlClientFromEnv({
			OPS_WEB_INTERNAL_TOKEN: "ops-token",
			OPS_WEB_INGESTION_CONTROL_URL: "http://ingestion-control:8000",
		});

		await expect(client.retryTask("task-001", "ops@example.test")).rejects.toMatchObject({
			status: 409,
			upstreamCode: "ingestion_task_still_running",
		});
		await expect(client.retryTask("task-001", "ops@example.test")).rejects.toBeInstanceOf(
			IngestionControlResponseError,
		);
	});
});
