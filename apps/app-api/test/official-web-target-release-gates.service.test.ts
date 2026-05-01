// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type {
	OfficialWebTargetInventoryRecord,
	OfficialWebTargetInventoryService,
} from "../src/modules/official-web-target-inventory";
import {
	buildOfficialWebTargetReleaseGateService,
	type OfficialWebTargetReleaseGateRecord,
	type OfficialWebTargetReleaseGateStore,
} from "../src/modules/official-web-target-release-gates";

function createOperatorPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: ["ops"],
			principalId: "ops@example.com",
			principalType: "operator",
			roles: ["operator"],
			userId: "ops@example.com",
		},
		permissions: {
			chat: false,
			operator: true,
		},
		principal: {
			displayName: "Ops Team",
			email: "ops@example.com",
			principalId: "ops@example.com",
			type: "operator",
		},
		session: null,
	};
}

const previewedStableReferenceEntry: OfficialWebTargetInventoryRecord = {
	admissionTargetId: "official-web-stable-reference",
	consumerFamily: "stable_reference_candidate",
	fieldStatus: {
		authoritative_source_url: "present",
		normalized_content_summary: "present",
		reference_title: "present",
		release_scope: "present",
		source_version_evidence: "present",
	},
	id: "muc-school-introduction-reference",
	inventoryId: "muc-school-introduction-reference",
	ownerSurface: "official_web/stable_reference",
	previewEvidence: {
		appApiRunId: "owrun_school_intro",
		currentTruthImportWasNull: true,
		ingestionStatus: "staged",
		inventoryId: "muc-school-introduction-reference",
		promotionDecision: "staged",
		rawAssetId: "owasset_school_intro",
		rawVersionId: "owver_school_intro",
		sourceObjectKeys: ["official_web/muc_public/runs/owrun_school_intro/source-truth-bundle.json"],
		targetAttemptId: "owattempt_school_intro",
		targetJobId: "owtarget_school_intro",
	},
	releaseBlockers: ["release_gate_not_reviewed"],
	requiredFields: [
		"reference_title",
		"normalized_content_summary",
		"authoritative_source_url",
		"release_scope",
		"source_version_evidence",
	],
	reviewState: "previewed",
	selectedWriteTarget: "official_web/stable_reference",
	sourceUrls: ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
	targetLabel: "中央民族大学学校简介",
};

function createReleaseGateStore(): OfficialWebTargetReleaseGateStore {
	return {
		getReleaseGateById: vi.fn(),
		updateReleaseGateExecutionStatus: vi.fn(
			async (input): Promise<OfficialWebTargetReleaseGateRecord> => ({
				createdAt: "2026-05-01T08:00:00.000Z",
				decidedAt: "2026-05-01T08:00:00.000Z",
				decidedBy: "ops@example.com",
				decision: "approved",
				errorJson: input.errorJson,
				evidenceJson: {
					inventoryId: "muc-school-introduction-reference",
				},
				executionJson: input.executionJson,
				inventoryId: "muc-school-introduction-reference",
				jobId: "owtarget_school_intro",
				notes: "reviewed against preview evidence",
				publishAlias: false,
				releaseId: input.releaseId,
				runId: "owrun_school_intro",
				status: input.status,
				summaryId: null,
				updatedAt: input.updatedAt,
			}),
		),
		upsertReleaseGate: vi.fn(async (record) => record),
	};
}

function createInventoryService(
	entry: OfficialWebTargetInventoryRecord,
): OfficialWebTargetInventoryService {
	return {
		getTargetInventoryEntryById: vi.fn().mockResolvedValue(entry),
		listTargetInventory: vi.fn(),
	};
}

describe("official web target release gate service", () => {
	it("approves a previewed stable reference release gate without publishing alias by default", async () => {
		const store = createReleaseGateStore();
		const inventoryService = createInventoryService(previewedStableReferenceEntry);
		const service = buildOfficialWebTargetReleaseGateService({
			inventoryService,
			now: () => new Date("2026-05-01T08:00:00.000Z"),
			store,
		});

		const result = await service.createReleaseGate({
			inventoryId: " muc-school-introduction-reference ",
			payload: {
				decision: "approved",
				notes: "reviewed against preview evidence",
			},
			principal: createOperatorPrincipal(),
		});

		const expectedReleaseId = "owrelease_muc_school_introduction_reference_owrun_school_intro";
		expect(result.releaseGate).toMatchObject({
			decidedBy: "ops@example.com",
			decision: "approved",
			inventoryId: "muc-school-introduction-reference",
			jobId: "owtarget_school_intro",
			notes: "reviewed against preview evidence",
			publishAlias: false,
			releaseId: expectedReleaseId,
			runId: "owrun_school_intro",
			status: "approved",
		});
		expect(store.upsertReleaseGate).toHaveBeenCalledWith(
			expect.objectContaining({
				evidenceJson: expect.objectContaining({
					fieldStatus: previewedStableReferenceEntry.fieldStatus,
					releaseBlockers: ["release_gate_not_reviewed"],
					sourceObjectKeys: previewedStableReferenceEntry.previewEvidence?.sourceObjectKeys,
					sourceUrls: ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
				}),
				publishAlias: false,
				releaseId: expectedReleaseId,
				status: "approved",
			}),
		);
	});

	it("fails closed when approval is requested before stable reference preview review is ready", async () => {
		const store = createReleaseGateStore();
		const inventoryService = createInventoryService({
			...previewedStableReferenceEntry,
			previewEvidence: null,
			releaseBlockers: ["no_preview_evidence"],
			reviewState: "candidate",
		});
		const service = buildOfficialWebTargetReleaseGateService({
			inventoryService,
			store,
		});

		await expect(
			service.createReleaseGate({
				inventoryId: "muc-school-introduction-reference",
				payload: { decision: "approved" },
				principal: createOperatorPrincipal(),
			}),
		).rejects.toMatchObject({
			code: "release_gate_not_ready",
			status: 409,
		});
		expect(store.upsertReleaseGate).not.toHaveBeenCalled();
	});

	it("updates executor progress from trusted internal callbacks", async () => {
		const store = createReleaseGateStore();
		const service = buildOfficialWebTargetReleaseGateService({
			inventoryService: createInventoryService(previewedStableReferenceEntry),
			now: () => new Date("2026-05-01T08:10:00.000Z"),
			store,
		});

		await expect(
			service.updateReleaseGateExecutionStatus({
				payload: {
					execution: {
						indexName: "official_web_stable_reference__r20260501_081000",
						publishAlias: false,
					},
					status: "indexed",
					updatedAt: "2026-05-01T08:11:00.000Z",
				},
				releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
			}),
		).resolves.toMatchObject({
			releaseGate: {
				releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
				status: "indexed",
			},
		});
		expect(store.updateReleaseGateExecutionStatus).toHaveBeenCalledWith({
			errorJson: null,
			executionJson: {
				indexName: "official_web_stable_reference__r20260501_081000",
				publishAlias: false,
			},
			releaseId: "owrelease_muc_school_introduction_reference_owrun_school_intro",
			status: "indexed",
			updatedAt: "2026-05-01T08:11:00.000Z",
		});
	});
});
