// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildOfficialWebRunAdmissionCleanupService,
	type OfficialWebRunAdmissionCleanupStore,
} from "../src/modules/official-web-run-admission";

describe("official web run admission cleanup service", () => {
	it("classifies pre-target-workset runs without existing decisions in dry-run mode", async () => {
		const store: OfficialWebRunAdmissionCleanupStore = {
			insertLegacyExclusionDecisions: vi.fn(),
			listCleanupCandidates: vi.fn().mockResolvedValue([
				{
					configVersion: "git:legacy",
					runId: "owrun_pre_target_workset",
					runIntent: "baseline",
					schedulerRunKey: "muc_public:pre-target-workset:2026-04-27",
					siteId: "muc_public",
					startedAt: "2026-04-27T08:00:00.000Z",
					summary: {
						pagesNormalized: 310,
						urlsDiscovered: 420,
					},
				},
			]),
		};
		const service = buildOfficialWebRunAdmissionCleanupService({
			generateId: () => "owad_legacy_001",
			now: () => new Date("2026-05-01T09:00:00.000Z"),
			store,
		});

		const result = await service.planLegacyCleanup({
			before: "2026-05-01T00:00:00.000Z",
			siteId: "muc_public",
		});

		expect(result).toEqual({
			action: "dry-run",
			before: "2026-05-01T00:00:00.000Z",
			decision: "legacy_contract_excluded",
			insertedCount: 0,
			siteId: "muc_public",
			candidates: [
				expect.objectContaining({
					decisionId: "owad_legacy_001",
					reasonCode: "pre_target_workset_contract",
					runId: "owrun_pre_target_workset",
					siteId: "muc_public",
				}),
			],
		});
		expect(store.insertLegacyExclusionDecisions).not.toHaveBeenCalled();
	});

	it("applies legacy exclusion decisions idempotently", async () => {
		const store: OfficialWebRunAdmissionCleanupStore = {
			insertLegacyExclusionDecisions: vi.fn().mockResolvedValue(1),
			listCleanupCandidates: vi.fn().mockResolvedValue([
				{
					configVersion: "git:legacy",
					runId: "owrun_pre_target_workset",
					runIntent: "baseline",
					schedulerRunKey: "muc_public:pre-target-workset:2026-04-27",
					siteId: "muc_public",
					startedAt: "2026-04-27T08:00:00.000Z",
					summary: {
						pagesNormalized: 310,
						urlsDiscovered: 420,
					},
				},
			]),
		};
		const service = buildOfficialWebRunAdmissionCleanupService({
			generateId: () => "owad_legacy_001",
			now: () => new Date("2026-05-01T09:00:00.000Z"),
			store,
		});

		const result = await service.applyLegacyCleanup({
			before: "2026-05-01T00:00:00.000Z",
			siteId: "muc_public",
		});

		expect(result.insertedCount).toBe(1);
		expect(store.insertLegacyExclusionDecisions).toHaveBeenCalledWith([
			expect.objectContaining({
				decision: "legacy_contract_excluded",
				decisionId: "owad_legacy_001",
				reasonCode: "pre_target_workset_contract",
				runId: "owrun_pre_target_workset",
			}),
		]);
	});
});
