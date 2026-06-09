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
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						inventoryId: "test-service-guide",
						inventoryOnly: false,
						materializationPolicy: "candidate_only",
						notes: "Test inventory row.",
						ownerCapabilityOrRuntime: "campus_services",
						ownerSurface: "service_guide_lookup",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence"],
						optionalEvidence: ["service_material"],
						optionalFields: ["required_materials"],
						requiredEvidence: ["service_process"],
						requiredFields: ["service_name", "source_url"],
						selectedWriteTarget: "campus_services/service_guide",
						sourceHosts: ["xxgk.muc.edu.cn"],
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "测试服务指南",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "muc_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: "service_guide_lookup",
				reviewState: null,
				siteId: "muc_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result).toMatchObject({
			entries: [
				{
					id: "test-service-guide",
					inventoryId: "test-service-guide",
					fieldStatus: {
						required_materials: "source_not_provided",
						service_process: "missing",
						service_name: "missing",
						source_url: "missing",
					},
					optionalEvidence: ["service_material"],
					optionalFields: ["required_materials"],
					releaseBlockers: ["no_preview_evidence"],
					reviewState: "candidate",
				},
			],
			summary: {
				countsByReviewState: { candidate: 1 },
				inventoryVersion: "test_inventory_v1",
				siteId: "muc_public",
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
						inventoryId: "test-service-guide",
						promotionDecision: "staged",
						rawAssetId: "owasset_preview",
						rawVersionId: "owver_preview",
						sourceObjectKeys: [
							"official_web/muc_public/runs/owrun_preview/source-truth-bundle.json",
						],
						targetAttemptId: "owattempt_preview",
						targetJobId: "owtarget_preview",
					},
				],
			},
			targetInventory: {
				entries: [
					{
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						inventoryId: "test-service-guide",
						inventoryOnly: false,
						materializationPolicy: "candidate_only",
						notes: "Test inventory row.",
						ownerCapabilityOrRuntime: "campus_services",
						ownerSurface: "service_guide_lookup",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence"],
						optionalEvidence: ["service_material"],
						optionalFields: ["required_materials"],
						requiredEvidence: ["service_process"],
						requiredFields: ["service_name", "source_url"],
						selectedWriteTarget: "campus_services/service_guide",
						sourceHosts: ["xxgk.muc.edu.cn"],
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "测试服务指南",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "muc_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: null,
				siteId: "muc_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result.entries[0]).toMatchObject({
			inventoryId: "test-service-guide",
			previewEvidence: {
				appApiRunId: "owrun_preview",
				targetAttemptId: "owattempt_preview",
			},
			releaseBlockers: ["missing_service_name", "missing_source_url", "missing_service_process"],
			reviewState: "blocked_fields",
		});
		expect(result.summary.countsByReviewState).toEqual({ blocked_fields: 1 });
	});

	it("marks inventory rows ready when preview lineage and required field review are complete", async () => {
		const service = buildOfficialWebTargetInventoryService({
			fieldStatusStore: {
				listFieldStatus: async () => ({
					"test-service-guide": {
						process_steps: "present",
						service_process: "present",
						service_name: "present",
						source_url: "present",
					},
				}),
			},
			previewEvidenceStore: {
				listPreviewEvidence: async () => [
					{
						appApiRunId: "owrun_preview",
						currentTruthImportWasNull: true,
						ingestionStatus: "staged",
						inventoryId: "test-service-guide",
						promotionDecision: "staged",
						rawAssetId: "owasset_preview",
						rawVersionId: "owver_preview",
						sourceObjectKeys: [
							"official_web/muc_public/runs/owrun_preview/source-truth-bundle.json",
						],
						targetAttemptId: "owattempt_preview",
						targetJobId: "owtarget_preview",
					},
				],
			},
			targetInventory: {
				entries: [
					{
						admissionTargetId: "campus-services-service-guide",
						consumerFamily: "service_guide_candidate",
						inventoryId: "test-service-guide",
						inventoryOnly: false,
						materializationPolicy: "candidate_only",
						notes: "Test inventory row.",
						ownerCapabilityOrRuntime: "campus_services",
						ownerSurface: "service_guide_lookup",
						previewStatus: "candidate",
						releaseBlockers: ["no_preview_evidence"],
						optionalEvidence: ["service_material"],
						optionalFields: ["required_materials"],
						requiredEvidence: ["service_process"],
						requiredFields: ["service_name", "process_steps", "source_url"],
						selectedWriteTarget: "campus_services/service_guide",
						sourceHosts: ["xxgk.muc.edu.cn"],
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
						targetLabel: "测试服务指南",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "muc_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: null,
				ownerSurface: null,
				reviewState: "ready_for_selected_write",
				siteId: "muc_public",
			},
			principal: createOperatorPrincipal(),
		});

		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]).toMatchObject({
			fieldStatus: {
				process_steps: "present",
				required_materials: "source_not_provided",
				service_process: "present",
				service_name: "present",
				source_url: "present",
			},
			optionalEvidence: ["service_material"],
			optionalFields: ["required_materials"],
			inventoryId: "test-service-guide",
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
							"official_web/muc_public/runs/owrun_preview/source-truth-bundle.json",
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
						ownerCapabilityOrRuntime: "knowledge",
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
						sourceHosts: ["xxgk.muc.edu.cn"],
						sourceUrls: ["https://xxgk.muc.edu.cn/info/1198/4101.htm"],
						targetLabel: "测试公开规章",
					},
				],
				inventoryVersion: "test_inventory_v1",
				schemaVersion: "official_web_target_inventory.v1",
				siteId: "muc_public",
			},
		});

		const result = await service.listTargetInventory({
			filters: {
				consumerFamily: "regulation_candidate",
				ownerSurface: "regulations/institutional_rules",
				reviewState: "ready_for_selected_write",
				siteId: "muc_public",
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
