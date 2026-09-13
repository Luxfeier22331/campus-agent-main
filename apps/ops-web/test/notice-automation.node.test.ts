// @vitest-environment node

import type { V1CronJob } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import { createNoticeAutomationService } from "../src/server/notice-automation";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import { createTestOpsApp } from "./helpers/ops-app";

function fixture(local = false) {
	const cron: V1CronJob = {
		spec: { schedule: "0 0 1 1 *", suspend: true, timeZone: "Asia/Shanghai", jobTemplate: {} },
		status: { lastSuccessfulTime: new Date("2026-09-13T01:00:00Z") },
	};
	const batch = {
		readNamespacedCronJob: vi.fn(async () => cron),
		patchNamespacedCronJob: vi.fn(
			async ({ body }: { body: Array<{ path: string; value: unknown }> }) => {
				if (cron.spec) {
					cron.spec.suspend = body[0]?.value as boolean;
					cron.spec.schedule = body[1]?.value as string;
				}
				return cron;
			},
		),
	};
	const credentials = { list: vi.fn(async () => [{ lastOutcome: "valid" }]) };
	const source = {
		get: vi.fn(async () => ({
			contentType: "application/json",
			body: new Response(
				JSON.stringify({
					schema_version: "internal_portal_notice_sync_state.v3",
					covered_from: "2025-12-01",
					covered_until: "2026-09-14",
					updated_at: "2026-09-13T01:00:00Z",
				}),
			).body as ReadableStream<Uint8Array>,
		})),
	};
	const service = createNoticeAutomationService({
		local,
		namespace: "campus-agent-staging",
		source,
		credentials: credentials as never,
		batch: batch as never,
	});
	return { service, batch, source, credentials };
}
describe("notice automation", () => {
	it("keeps local scheduling unsupported and admits requests before reading configuration", async () => {
		const { service, batch } = fixture(true);
		expect(await service.get()).toMatchObject({ supported: false, enabled: null });
		await expect(service.update({ enabled: true, intervalMinutes: 15 })).rejects.toThrow(
			"本地环境不运行定时采集",
		);
		expect(batch.readNamespacedCronJob).not.toHaveBeenCalled();
		expect(batch.patchNamespacedCronJob).not.toHaveBeenCalled();
		const get = vi.spyOn(service, "get");
		const update = vi.spyOn(service, "update");
		const app = createTestOpsApp({
			noticeAutomationService: service,
			admission: {
				admit: async () => ({ operator: null, response: new Response(null, { status: 401 }) }),
			},
		});
		for (const method of ["GET", "PUT"]) {
			expect((await app.request("/api/ops/notices/automation", { method })).status).toBe(401);
		}
		expect(get).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
	it("reads the actual schedule and patches only the two operator-owned fields", async () => {
		const { service, batch } = fixture();
		expect(await service.get()).toMatchObject({
			supported: true,
			enabled: false,
			intervalMinutes: null,
			credentialAvailable: true,
			maintenanceRange: { from: "2025-12-01", to: "2026-09-14" },
		});
		expect(await service.update({ enabled: true, intervalMinutes: 15 })).toMatchObject({
			enabled: true,
			intervalMinutes: 15,
		});
		expect(batch.patchNamespacedCronJob).toHaveBeenCalledWith({
			name: "notice-sync",
			namespace: "campus-agent-staging",
			body: [
				{ op: "add", path: "/spec/suspend", value: false },
				{ op: "add", path: "/spec/schedule", value: "*/15 * * * *" },
			],
		});
		expect(await service.update({ enabled: true, intervalMinutes: 60 })).toMatchObject({
			intervalMinutes: 60,
		});
	});
	it("keeps unavailable status separate and allows pausing without credentials or source", async () => {
		const { service, source, credentials } = fixture();
		source.get.mockRejectedValue(new Error("source unavailable"));
		credentials.list.mockRejectedValue(new Error("credentials unavailable"));
		expect(await service.get()).toMatchObject({
			enabled: false,
			maintenanceRange: null,
			credentialAvailable: null,
			stateError: "source unavailable",
			credentialError: "credentials unavailable",
		});
		await expect(service.update({ enabled: true, intervalMinutes: 15 })).rejects.toThrow(
			"source unavailable",
		);
		expect(await service.update({ enabled: false, intervalMinutes: 30 })).toMatchObject({
			enabled: false,
			intervalMinutes: 30,
		});
	});
	it("does not turn Kubernetes errors into disabled or successful state", async () => {
		const { service, batch } = fixture();
		batch.readNamespacedCronJob.mockRejectedValue(new Error("forbidden"));
		expect(await service.get()).toMatchObject({ enabled: null, scheduleError: "forbidden" });
		batch.patchNamespacedCronJob.mockRejectedValue(new Error("patch denied"));
		await expect(service.update({ enabled: false, intervalMinutes: 15 })).rejects.toThrow(
			"patch denied",
		);
	});
	it("validates the HTTP input and refuses arbitrary Kubernetes fields", async () => {
		const { service } = fixture();
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeAutomationService: service,
		});
		expect((await app.request("/api/ops/notices/automation")).status).toBe(200);
		for (const body of [
			{ enabled: true, intervalMinutes: 5 },
			{ enabled: true, intervalMinutes: 15, command: "arbitrary" },
		]) {
			expect(
				(
					await app.request("/api/ops/notices/automation", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					})
				).status,
			).toBe(400);
		}
		expect(
			(
				await app.request("/api/ops/notices/automation", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ enabled: true, intervalMinutes: 15 }),
				})
			).status,
		).toBe(200);
	});
});
