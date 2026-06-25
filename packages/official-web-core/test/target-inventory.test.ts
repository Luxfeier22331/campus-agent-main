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
			candidate: 23,
		});
		expect(report.entries[0]).toMatchObject({
			inventoryId: "muc-public-academic-calendar",
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
			inventoryId: "muc-public-academic-calendar",
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
			inventoryId: "muc-public-academic-calendar",
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
			inventoryId: "muc-public-academic-calendar",
			promotionDecision: "staged",
			rawAssetId: "owasset_01",
			rawVersionId: "owver_01",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_01/source-truth-bundle.json"],
			targetAttemptId: "owattempt_01",
			targetJobId: "owtarget_muc_public_contact",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			fieldStatusByInventoryId: {
				"muc-public-academic-calendar": {
					academic_year_label: "present",
					calendar_arrangement: "present",
					date_range: "present",
					source_url: "present",
					source_version_evidence: "present",
					term_label: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			fieldStatus: expect.objectContaining({
				calendar_arrangement: "present",
			}),
			inventoryId: "muc-public-academic-calendar",
			optionalEvidence: [],
			optionalFields: ["holiday_name", "week_index", "class_day_pattern"],
			requiredEvidence: ["calendar_arrangement"],
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
	});

	it("blocks selected-write readiness when release-blocking evidence is missing", () => {
		const inventory = normalizeOfficialWebTargetInventoryManifest({
			entries: [
				{
					admission_target_id: "official-web-academic-calendar",
					consumer_family: "academic_calendar_candidate",
					inventory_id: "calendar-missing-family-evidence",
					inventory_only: false,
					materialization_policy: "candidate_only",
					notes: "Calendar row that still needs family evidence.",
					owner_capability_or_runtime: "calendar",
					owner_surface: "calendar/academic_calendar",
					preview_status: "candidate",
					release_blockers: ["no_preview_evidence"],
					optional_evidence: [],
					optional_fields: ["holiday_name", "week_index"],
					required_evidence: ["calendar_arrangement"],
					required_fields: ["academic_year_label", "source_url", "source_version_evidence"],
					selected_write_target: "calendar/academic_calendar",
					source_hosts: ["www.muc.edu.cn"],
					source_urls: ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
					target_label: "校历测试",
				},
			],
			inventory_version: "test_inventory_v2",
			schema_version: "official_web_target_inventory.v1",
			site_id: "muc_public",
		});
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_contact",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "calendar-missing-family-evidence",
			promotionDecision: "staged",
			rawAssetId: "owasset_contact",
			rawVersionId: "owver_contact",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"],
			targetAttemptId: "owattempt_contact",
			targetJobId: "owtarget_contact",
		};

		const report = buildOfficialWebTargetInventoryReportFromInventory(inventory, {
			fieldStatusByInventoryId: {
				"calendar-missing-family-evidence": {
					academic_year_label: "present",
					source_url: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			fieldStatus: expect.objectContaining({
				calendar_arrangement: "missing",
			}),
			optionalEvidence: [],
			releaseBlockers: expect.arrayContaining(["missing_calendar_arrangement"]),
			reviewState: "blocked_fields",
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

		const stableReferenceEntry = report.entries.find(
			(entry) => entry.inventoryId === "muc-school-introduction-reference",
		);
		expect(stableReferenceEntry).toMatchObject({
			inventoryId: "muc-school-introduction-reference",
			releaseBlockers: ["release_gate_not_reviewed"],
			reviewState: "previewed",
		});
		expect(report.countsByReviewState).toMatchObject({
			candidate: 22,
			previewed: 1,
		});
	});

	it("treats release-gated regulation targets as ingestion-lane ready after preview and field checks", () => {
		const config = loadOfficialWebConfig("muc_public");
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_rules",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "muc-academic-committee-charter",
			promotionDecision: "staged",
			rawAssetId: "owasset_rules",
			rawVersionId: "owver_rules",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_rules/source-truth-bundle.json"],
			targetAttemptId: "owattempt_rules",
			targetJobId: "owtarget_rules",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			fieldStatusByInventoryId: {
				"muc-academic-committee-charter": {
					authoritative_source_url: "present",
					normalized_content_summary: "present",
					reference_title: "present",
					release_scope: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		const regulationEntry = report.entries.find(
			(entry) => entry.inventoryId === "muc-academic-committee-charter",
		);
		expect(regulationEntry).toMatchObject({
			inventoryId: "muc-academic-committee-charter",
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
	});

	it("includes active calendar, stable reference, and public regulation targets only", () => {
		const config = loadOfficialWebConfig("muc_public");
		const inventoryIds = config.targetInventory.entries.map((entry) => entry.inventoryId);

		expect(inventoryIds).toEqual(
			expect.arrayContaining([
				"muc-public-academic-calendar",
				"muc-it-email-policy-reference",
				"muc-it-information-system-management-policy-reference",
				"muc-it-network-security-policy-reference",
				"muc-it-campus-network-account-policy-reference",
				"muc-it-campus-card-policy-reference",
				"muc-it-information-portal-policy-reference",
				"muc-it-office-automation-policy-reference",
				"muc-student-status-management-rule",
				"muc-student-financial-aid-rule",
				"muc-student-degree-rule",
				"muc-student-reward-discipline-rule",
				"muc-it-secondary-website-policy-reference",
				"muc-it-campus-network-access-policy-reference",
				"muc-academic-committee-charter",
				"muc-staff-congress-procedure",
				"muc-administrative-offices-reference",
				"muc-teaching-research-units-reference",
				"muc-library-reference",
				"muc-museum-reference",
				"muc-fee-disclosure-reference",
			]),
		);
		expect(inventoryIds).not.toContain("muc-it-network-auth-service-guide");
		expect(inventoryIds).not.toContain("muc-it-service-contacts");
	});

	it("normalizes bundled manifest JSON into the same report contract without filesystem access", () => {
		const inventory = normalizeOfficialWebTargetInventoryManifest({
			entries: [
				{
					admission_target_id: "official-web-academic-calendar",
					consumer_family: "academic_calendar_candidate",
					inventory_id: "test-academic-calendar",
					inventory_only: false,
					materialization_policy: "candidate_only",
					notes: "Test inventory row.",
					owner_capability_or_runtime: "calendar",
					owner_surface: "calendar/academic_calendar",
					preview_status: "candidate",
					release_blockers: ["no_preview_evidence"],
					optional_evidence: [],
					optional_fields: ["holiday_name", "week_index"],
					required_evidence: ["calendar_arrangement"],
					required_fields: ["academic_year_label"],
					selected_write_target: "calendar/academic_calendar",
					source_hosts: ["www.muc.edu.cn"],
					source_urls: ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
					target_label: "测试校历",
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
					inventoryId: "test-academic-calendar",
					optionalEvidence: [],
					optionalFields: ["holiday_name", "week_index"],
					requiredFields: ["academic_year_label"],
					reviewState: "candidate",
				},
			],
			inventoryVersion: "test_inventory_v1",
			siteId: "muc_public",
		});
	});
});
