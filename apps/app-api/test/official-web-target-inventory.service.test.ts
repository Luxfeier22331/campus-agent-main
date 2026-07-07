// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import { buildOfficialWebTargetInventoryService } from "../src/modules/official-web-target-inventory";

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

describe("official web target inventory service", () => {
	it("builds the operator projection from the canonical inventory manifest", async () => {
		const service = buildOfficialWebTargetInventoryService({
			targetInventory: {
				entries: [
					{
						admissionTargetId: "official-web-institutional-rules",
						consumerFamily: "regulation_candidate",
						inventoryId: "test-public-regulation",
						inventoryOnly: false,
						materializationPolicy: "release_gate_required",
						notes: "Test inventory row.",
						ownerToolOrRuntime: "knowledge",
						ownerSurface: "regulations/institutional_rules",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						optionalEvidence: [],
						optionalFields: [],
						requiredEvidence: ["regulation_text"],
						requiredFields: ["reference_title", "authoritative_source_url"],
						selectedWriteTarget: "regulations/institutional_rules",
						sourceHosts: ["info.example.edu"],
						sourceUrls: ["https://info.example.edu/info/1198/4101.htm"],
						targetLabel: "测试公开规章",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "example_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: "regulations/institutional_rules",
				reviewState: null,
				siteId: "example_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result).toMatchObject({
			entries: [
				{
					id: "test-public-regulation",
					inventoryId: "test-public-regulation",
					fieldStatus: {
						authoritative_source_url: "missing",
						reference_title: "missing",
					},
					optionalEvidence: [],
					optionalFields: [],
					releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
					reviewState: "candidate",
				},
			],
			summary: {
				countsByReviewState: { candidate: 1 },
				inventoryVersion: "test_inventory_v1",
				siteId: "example_public",
			},
		});
	});

	it("marks inventory rows as blocked_fields when preview evidence exists but field review is incomplete", async () => {
		const service = buildOfficialWebTargetInventoryService({
			previewEvidenceStore: {
				listPreviewEvidence: async () => [
					{
						appApiRunId: "owrun_preview",
						currentTruthImportWasNull: true,
						ingestionStatus: "staged",
						inventoryId: "test-public-regulation",
						promotionDecision: "staged",
						rawAssetId: "owasset_preview",
						rawVersionId: "owver_preview",
						sourceObjectKeys: [
							"official_web/example_public/runs/owrun_preview/source-truth-bundle.json",
						],
						targetAttemptId: "owattempt_preview",
						targetJobId: "owtarget_preview",
					},
				],
			},
			targetInventory: {
				entries: [
					{
						admissionTargetId: "official-web-institutional-rules",
						consumerFamily: "regulation_candidate",
						inventoryId: "test-public-regulation",
						inventoryOnly: false,
						materializationPolicy: "release_gate_required",
						notes: "Test inventory row.",
						ownerToolOrRuntime: "knowledge",
						ownerSurface: "regulations/institutional_rules",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						optionalEvidence: [],
						optionalFields: [],
						requiredEvidence: ["regulation_text"],
						requiredFields: ["reference_title", "authoritative_source_url"],
						selectedWriteTarget: "regulations/institutional_rules",
						sourceHosts: ["info.example.edu"],
						sourceUrls: ["https://info.example.edu/info/1198/4101.htm"],
						targetLabel: "测试公开规章",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "example_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: null,
				siteId: "example_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result.entries[0]).toMatchObject({
			inventoryId: "test-public-regulation",
			previewEvidence: {
				appApiRunId: "owrun_preview",
				targetAttemptId: "owattempt_preview",
			},
			releaseBlockers: ["missing_reference_title", "missing_authoritative_source_url"],
			reviewState: "blocked_fields",
		});
		expect(result.summary.countsByReviewState).toEqual({ blocked_fields: 1 });
	});

	it("marks inventory rows ready when preview lineage and required field review are complete", async () => {
		const service = buildOfficialWebTargetInventoryService({
			fieldStatusStore: {
				listFieldStatus: async () => ({
					"test-public-regulation": {
						authoritative_source_url: "present",
						reference_title: "present",
					},
				}),
			},
			previewEvidenceStore: {
				listPreviewEvidence: async () => [
					{
						appApiRunId: "owrun_preview",
						currentTruthImportWasNull: true,
						ingestionStatus: "staged",
						inventoryId: "test-public-regulation",
						promotionDecision: "staged",
						rawAssetId: "owasset_preview",
						rawVersionId: "owver_preview",
						sourceObjectKeys: [
							"official_web/example_public/runs/owrun_preview/source-truth-bundle.json",
						],
						targetAttemptId: "owattempt_preview",
						targetJobId: "owtarget_preview",
					},
				],
			},
			targetInventory: {
				entries: [
					{
						admissionTargetId: "official-web-institutional-rules",
						consumerFamily: "regulation_candidate",
						inventoryId: "test-public-regulation",
						inventoryOnly: false,
						materializationPolicy: "release_gate_required",
						notes: "Test inventory row.",
						ownerToolOrRuntime: "knowledge",
						ownerSurface: "regulations/institutional_rules",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						optionalEvidence: [],
						optionalFields: [],
						requiredEvidence: ["regulation_text"],
						requiredFields: ["reference_title", "authoritative_source_url"],
						selectedWriteTarget: "regulations/institutional_rules",
						sourceHosts: ["info.example.edu"],
						sourceUrls: ["https://info.example.edu/info/1198/4101.htm"],
						targetLabel: "测试公开规章",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "example_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: "ready_for_selected_write",
				siteId: "example_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			fieldStatus: {
				authoritative_source_url: "present",
				reference_title: "present",
			},
			optionalEvidence: [],
			optionalFields: [],
			inventoryId: "test-public-regulation",
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
		expect(result.summary.countsByReviewState).toEqual({ ready_for_selected_write: 1 });
	});

	it("treats regulation inventory rows as ingestion-lane ready instead of app-api release-gated", async () => {
		const service = buildOfficialWebTargetInventoryService({
			fieldStatusStore: {
				listFieldStatus: async () => ({
					"test-public-regulation": {
						authoritative_source_url: "present",
						normalized_content_summary: "present",
						reference_title: "present",
						release_scope: "present",
						source_version_evidence: "present",
					},
				}),
			},
			previewEvidenceStore: {
				listPreviewEvidence: async () => [
					{
						appApiRunId: "owrun_preview",
						currentTruthImportWasNull: true,
						ingestionStatus: "staged",
						inventoryId: "test-public-regulation",
						promotionDecision: "staged",
						rawAssetId: "owasset_preview",
						rawVersionId: "owver_preview",
						sourceObjectKeys: [
							"official_web/example_public/runs/owrun_preview/source-truth-bundle.json",
						],
						targetAttemptId: "owattempt_preview",
						targetJobId: "owtarget_preview",
					},
				],
			},
			targetInventory: {
				entries: [
					{
						admissionTargetId: "official-web-institutional-rules",
						consumerFamily: "regulation_candidate",
						inventoryId: "test-public-regulation",
						inventoryOnly: false,
						materializationPolicy: "release_gate_required",
						notes: "Public regulation row.",
						ownerToolOrRuntime: "knowledge",
						ownerSurface: "regulations/institutional_rules",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence", "release_gate_not_reviewed"],
						optionalEvidence: [],
						optionalFields: [],
						requiredEvidence: ["regulation_text"],
						requiredFields: [
							"reference_title",
							"normalized_content_summary",
							"authoritative_source_url",
							"release_scope",
							"source_version_evidence",
						],
						selectedWriteTarget: "regulations/institutional_rules",
						sourceHosts: ["info.example.edu"],
						sourceUrls: ["https://info.example.edu/info/1198/4101.htm"],
						targetLabel: "测试公开规章",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "example_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: "regulation_candidate",
				ownerSurface: "regulations/institutional_rules",
				reviewState: "ready_for_selected_write",
				siteId: "example_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			inventoryId: "test-public-regulation",
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
	});
});
