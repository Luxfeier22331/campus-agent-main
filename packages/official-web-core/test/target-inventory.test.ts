import { describe, expect, it } from "vitest";

import {
	buildOfficialWebTargetInventoryReport,
	buildOfficialWebTargetInventoryReportFromInventory,
	loadOfficialWebConfig,
	normalizeOfficialWebTargetInventoryManifest,
	type OfficialWebTargetInventoryPreviewEvidence,
} from "../src/index";

describe("official web target inventory report", () => {
	it("keeps repo inventory entries as candidates until replayable preview evidence exists", () => {
		const config = loadOfficialWebConfig("muc_public");

		const report = buildOfficialWebTargetInventoryReport(config);

		expect(report.countsByReviewState).toMatchObject({
			candidate: 3,
		});
		expect(report.entries[0]).toMatchObject({
			inventoryId: "muc-main-homepage-contact",
			reviewState: "candidate",
			releaseBlockers: expect.arrayContaining(["no_preview_evidence"]),
		});
	});

	it("marks previewed entries with incomplete replay lineage as blocked_lineage", () => {
		const config = loadOfficialWebConfig("muc_public");
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_01",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "muc-main-homepage-contact",
			promotionDecision: "staged",
			rawAssetId: "",
			rawVersionId: "owver_01",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_01/source-truth-bundle.json"],
			targetAttemptId: "owattempt_01",
			targetJobId: "owtarget_muc_public_contact",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			inventoryId: "muc-main-homepage-contact",
			reviewState: "blocked_lineage",
			releaseBlockers: expect.arrayContaining(["missing_raw_asset_id"]),
		});
	});

	it("marks previewed entries as ready when replay lineage and required fields pass", () => {
		const config = loadOfficialWebConfig("muc_public");
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_01",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "muc-main-homepage-contact",
			promotionDecision: "staged",
			rawAssetId: "owasset_01",
			rawVersionId: "owver_01",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_01/source-truth-bundle.json"],
			targetAttemptId: "owattempt_01",
			targetJobId: "owtarget_muc_public_contact",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			fieldStatusByInventoryId: {
				"muc-main-homepage-contact": {
					location: "present",
					organization_name: "present",
					phone: "present",
					source_url: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			inventoryId: "muc-main-homepage-contact",
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
	});

	it("keeps release-gated stable references out of selected-write readiness", () => {
		const config = loadOfficialWebConfig("muc_public");
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_school_intro",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "muc-school-introduction-reference",
			promotionDecision: "staged",
			rawAssetId: "owasset_school_intro",
			rawVersionId: "owver_school_intro",
			sourceObjectKeys: [
				"official_web/muc_public/runs/owrun_school_intro/source-truth-bundle.json",
			],
			targetAttemptId: "owattempt_school_intro",
			targetJobId: "owtarget_school_intro",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			fieldStatusByInventoryId: {
				"muc-school-introduction-reference": {
					authoritative_source_url: "present",
					normalized_content_summary: "present",
					reference_title: "present",
					release_scope: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[2]).toMatchObject({
			inventoryId: "muc-school-introduction-reference",
			releaseBlockers: ["release_gate_not_reviewed"],
			reviewState: "previewed",
		});
		expect(report.countsByReviewState).toMatchObject({
			candidate: 2,
			previewed: 1,
		});
	});

	it("normalizes bundled manifest JSON into the same report contract without filesystem access", () => {
		const inventory = normalizeOfficialWebTargetInventoryManifest({
			entries: [
				{
					admission_target_id: "campus-services-service-guide",
					consumer_family: "service_guide_candidate",
					inventory_id: "test-service-guide",
					inventory_only: false,
					materialization_policy: "candidate_only",
					notes: "Test inventory row.",
					owner_agent_or_runtime: "campus-services-agent",
					owner_surface: "service_guide_lookup",
					preview_status: "candidate",
					release_blockers: ["no_preview_evidence"],
					required_evidence: ["service_process"],
					required_fields: ["service_name"],
					selected_write_target: "campus_services/service_guide",
					source_hosts: ["xxgk.muc.edu.cn"],
					source_urls: ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
					target_label: "测试服务指南",
				},
			],
			inventory_version: "test_inventory_v1",
			schema_version: "official_web_target_inventory.v1",
			site_id: "muc_public",
		});

		const report = buildOfficialWebTargetInventoryReportFromInventory(inventory);

		expect(report).toMatchObject({
			countsByReviewState: { candidate: 1 },
			entries: [
				{
					inventoryId: "test-service-guide",
					requiredFields: ["service_name"],
					reviewState: "candidate",
				},
			],
			inventoryVersion: "test_inventory_v1",
			siteId: "muc_public",
		});
	});
});
