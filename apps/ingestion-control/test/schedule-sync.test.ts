import { ScheduleAlreadyRunning, ScheduleOverlapPolicy } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";

import {
	buildInternalPortalAuthScheduleOptions,
	buildInternalPortalNoticeScheduleOptions,
	type MaintenanceScheduleClient,
	type NoticeScheduleClient,
	syncInternalPortalAuthSchedule,
	syncInternalPortalNoticeSchedule,
} from "../src/schedule-sync";

const config = {
	address: "temporal.example:7233",
	controlActivityTaskQueue: "ingestion.control",
	namespace: "campus-agent",
	rustKernelActivityTaskQueue: "ingestion.rust",
	sourceCollectorActivityTaskQueue: "ingestion.source",
	workflowTaskQueue: "ingestion.workflow",
};

describe("internal portal auth schedule sync", () => {
	it("builds the fixed half-hour schedule paused until the first credential", () => {
		const schedule = buildInternalPortalAuthScheduleOptions(config);

		expect(schedule).toMatchObject({
			action: {
				args: [
					{
						controlActivityTaskQueue: "ingestion.control",
						sourceCollectorActivityTaskQueue: "ingestion.source",
					},
				],
				taskQueue: "ingestion.workflow",
				workflowId: "ingestion/internal-portal-auth-maintenance",
			},
			policies: {
				catchupWindow: "30 minutes",
				overlap: ScheduleOverlapPolicy.SKIP,
				pauseOnFailure: true,
			},
			scheduleId: "internal-portal-auth-maintenance",
			spec: { intervals: [{ every: "30 minutes" }] },
			state: { note: "awaiting initial credential", paused: true },
		});
	});

	it("creates a missing schedule", async () => {
		const client = fakeClient();

		await expect(syncInternalPortalAuthSchedule(client, config)).resolves.toBe("created");
		expect(client.create).toHaveBeenCalledWith(
			expect.objectContaining({
				state: { note: "awaiting initial credential", paused: true },
			}),
		);
		expect(client.update).not.toHaveBeenCalled();
	});

	it("updates drift while preserving an expired credential pause", async () => {
		const client = fakeClient({ alreadyExists: true, paused: true });

		await expect(syncInternalPortalAuthSchedule(client, config)).resolves.toBe("updated");
		expect(client.update).toHaveBeenCalledOnce();
		const updateFn = client.update.mock.calls[0]?.[0];
		expect(updateFn?.({ state: { note: "credential expired", paused: true } })).toMatchObject({
			state: { note: "credential expired", paused: true },
		});
	});
});

describe("internal portal notice schedule sync", () => {
	it("builds a paused half-hour publication schedule", () => {
		expect(buildInternalPortalNoticeScheduleOptions(config)).toMatchObject({
			action: {
				args: [
					{
						collectionMode: "incremental",
						createdBy: "schedule:internal-portal-notice",
						overlapPages: 1,
					},
				],
				workflowId: "ingestion/internal-portal-notice-publication",
			},
			policies: {
				overlap: ScheduleOverlapPolicy.SKIP,
				pauseOnFailure: true,
			},
			scheduleId: "internal-portal-notice-publication",
			spec: { intervals: [{ every: "30 minutes" }] },
			state: { note: "awaiting operator enable", paused: true },
		});
	});

	it("preserves the current pause state while updating the notice schedule", async () => {
		const client = fakeClient({ alreadyExists: true });
		await expect(
			syncInternalPortalNoticeSchedule(client as unknown as NoticeScheduleClient, config),
		).resolves.toBe("updated");
		const updateFn = client.update.mock.calls[0]?.[0];
		expect(updateFn?.({ state: { note: "credential expired", paused: true } })).toMatchObject({
			state: { note: "credential expired", paused: true },
		});
	});
});

function fakeClient(options: { alreadyExists?: boolean; paused?: boolean } = {}) {
	const update = vi.fn(
		async (_updateFn: (previous: { state: { note?: string; paused: boolean } }) => unknown) =>
			undefined,
	);
	const client = {
		create: vi.fn(async () => {
			if (options.alreadyExists) {
				throw new ScheduleAlreadyRunning("already exists", "internal-portal-auth-maintenance");
			}
		}),
		getHandle: vi.fn(() => ({ update })),
		update,
	};
	return client as typeof client & MaintenanceScheduleClient;
}
