// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
	createInternalPortalAuthMaintenanceClientFromEnv,
	InternalPortalAuthMaintenanceUnavailableError,
} from "../src/server/internal-portal-auth-maintenance-client";

describe("internal portal auth maintenance client", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("queries and resumes only the fixed ingestion-control operation", async () => {
		const fetchFn = vi.fn(async () =>
			Response.json({
				errorCode: null,
				lastAttemptAt: "2026-07-16T00:00:00.000Z",
				lastOutcome: "SUCCESS",
				lastSuccessAt: "2026-07-16T00:00:03.000Z",
				nextRunAt: "2026-07-16T00:30:00.000Z",
				noticeProbeSucceeded: true,
				portalSessionEstablished: true,
				scheduleState: "ACTIVE",
				serviceTicketIssued: true,
			}),
		);
		vi.stubGlobal("fetch", fetchFn);
		const client = createInternalPortalAuthMaintenanceClientFromEnv({
			OPS_WEB_INTERNAL_TOKEN: "ops-token",
			OPS_WEB_INGESTION_CONTROL_URL: "http://ingestion-control:8000/",
		});

		await expect(client.getStatus()).resolves.toMatchObject({ lastOutcome: "SUCCESS" });
		await client.resume();
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
			"http://ingestion-control:8000/internal/ingestion/operations/internal-portal-auth-maintenance/resume",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("keeps reads available but refuses resume when runtime config is absent", async () => {
		const client = createInternalPortalAuthMaintenanceClientFromEnv({});

		await expect(client.getStatus()).resolves.toMatchObject({ scheduleState: "UNAVAILABLE" });
		await expect(client.resume()).rejects.toBeInstanceOf(
			InternalPortalAuthMaintenanceUnavailableError,
		);
	});
});
