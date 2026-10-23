import { ScheduleAlreadyRunning } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { initializeSchedule } from "../src/schedule.ts";

describe("schedule initialization", () => {
	it("creates a paused schedule with skip overlap and bounded catchup", async () => {
		const create = vi.fn();
		await initializeSchedule({ schedule: { create } } as never);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				spec: { intervals: [{ every: "15 minutes" }] },
				state: expect.objectContaining({ paused: true }),
				policies: { overlap: "SKIP", catchupWindow: "5 minutes" },
				action: expect.objectContaining({ workflowType: "noticePipelineScheduled" }),
			}),
		);
	});
	it("preserves operator interval and pause while updating deployment-owned action", async () => {
		const existing = {
			spec: { intervals: [{ every: 900000 }] },
			state: { paused: false },
			action: { workflowType: "old" },
		};
		let updated:
			| { spec: unknown; state: { paused: boolean }; action: { workflowType: string } }
			| undefined;
		await initializeSchedule({
			schedule: {
				create: async () => {
					throw new ScheduleAlreadyRunning("exists", "notice-pipeline");
				},
				getHandle: () => ({
					update: async (fn: (value: typeof existing) => typeof existing) => {
						updated = fn(existing);
					},
				}),
			},
		} as never);
		expect(updated.spec).toEqual(existing.spec);
		expect(updated.state.paused).toBe(false);
		expect(updated.action.workflowType).toBe("noticePipelineScheduled");
	});
});
