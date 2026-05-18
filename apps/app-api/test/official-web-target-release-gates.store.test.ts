// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { OfficialWebTargetReleaseGateRecord } from "../src/modules/official-web-target-release-gates";
import { createPgOfficialWebTargetReleaseGateStore } from "../src/modules/official-web-target-release-gates";

function releaseGateRecord(
	overrides: Partial<OfficialWebTargetReleaseGateRecord> = {},
): OfficialWebTargetReleaseGateRecord {
	return {
		createdAt: "2026-05-01T08:00:00.000Z",
		decidedAt: "2026-05-01T08:00:00.000Z",
		decidedBy: "ops@example.com",
		decision: "approved",
		errorJson: null,
		evidenceJson: {
			sourceObjectKeys: ["official_web/muc_public/runs/owrun/source-truth-bundle.json"],
		},
		executionJson: null,
		inventoryId: "muc-school-introduction-reference",
		jobId: "owtarget_school_intro",
		notes: "reviewed",
		publishAlias: false,
		releaseId: "owrelease_muc_school_introduction_reference_owrun",
		runId: "owrun",
		status: "approved",
		summaryId: null,
		updatedAt: "2026-05-01T08:00:00.000Z",
		...overrides,
	};
}

describe("official web target release gate store", () => {
	it("updates decision on release id upsert conflicts to avoid decision/status drift", async () => {
		const returning = vi.fn().mockResolvedValue([
			{
				...releaseGateRecord({ decision: "rejected", status: "rejected" }),
				createdAt: new Date("2026-05-01T08:00:00.000Z"),
				decidedAt: new Date("2026-05-01T08:00:00.000Z"),
				updatedAt: new Date("2026-05-01T08:00:00.000Z"),
			},
		]);
		const onConflictDoUpdate = vi.fn(() => ({ returning }));
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const db = {
			insert: vi.fn(() => ({ values })),
		};
		const store = createPgOfficialWebTargetReleaseGateStore({} as never, {
			getDb: () => db as never,
		});

		await store.upsertReleaseGate(releaseGateRecord({ decision: "rejected", status: "rejected" }));

		expect(onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({
					decision: expect.anything(),
					status: expect.anything(),
				}),
			}),
		);
	});
});
