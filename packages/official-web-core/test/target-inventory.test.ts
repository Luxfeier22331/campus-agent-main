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
			candidate: 36,
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
					email: "source_not_provided",
					location: "present",
					organization_name: "present",
					office_hours: "source_not_provided",
					phone: "present",
					source_url: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			fieldStatus: expect.objectContaining({
				email: "source_not_provided",
				office_hours: "source_not_provided",
			}),
			inventoryId: "muc-main-homepage-contact",
			optionalEvidence: ["email", "location", "office_hours"],
			optionalFields: ["email", "location", "office_hours"],
			requiredEvidence: ["phone"],
			releaseBlockers: [],
			reviewState: "ready_for_selected_write",
		});
	});

	it("marks the campus card service guide ready with optional gaps after preview evidence", () => {
		const config = loadOfficialWebConfig("muc_public");
		const evidence: OfficialWebTargetInventoryPreviewEvidence = {
			appApiRunId: "owrun_card",
			currentTruthImportWasNull: true,
			ingestionStatus: "staged",
			inventoryId: "muc-it-student-campus-card-service-guide",
			promotionDecision: "staged",
			rawAssetId: "owasset_card",
			rawVersionId: "owver_card",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_card/source-truth-bundle.json"],
			targetAttemptId: "owattempt_card",
			targetJobId: "owtarget_muc_public_service",
		};

		const report = buildOfficialWebTargetInventoryReport(config, {
			fieldStatusByInventoryId: {
				"muc-it-student-campus-card-service-guide": {
					location: "present",
					office_hours: "source_not_provided",
					phone: "present",
					process_steps: "present",
					required_materials: "present",
					responsible_office: "source_not_provided",
					service_entry: "present",
					service_material: "present",
					service_name: "present",
					service_process: "present",
					source_url: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});
		const entry = report.entries.find(
			(item) => item.inventoryId === "muc-it-student-campus-card-service-guide",
		);

		expect(entry).toMatchObject({
			fieldStatus: expect.objectContaining({
				office_hours: "source_not_provided",
				service_process: "present",
			}),
			optionalEvidence: ["service_entry", "service_material", "phone", "location", "office_hours"],
			releaseBlockers: [],
			requiredEvidence: ["service_process"],
			reviewState: "ready_for_selected_write",
			sourceUrls: ["https://met.muc.edu.cn/info/1027/1127.htm"],
		});
	});

	it("blocks selected-write readiness when release-blocking evidence is missing", () => {
		const inventory = normalizeOfficialWebTargetInventoryManifest({
			entries: [
				{
					admission_target_id: "campus-services-contact-directory",
					consumer_family: "contact_directory_candidate",
					inventory_id: "contact-missing-family-evidence",
					inventory_only: false,
					materialization_policy: "candidate_only",
					notes: "Contact row that still needs family evidence.",
					owner_agent_or_runtime: "campus-services-agent",
					owner_surface: "contact_directory_lookup",
					preview_status: "candidate",
					release_blockers: ["no_preview_evidence"],
					optional_evidence: ["email", "location", "office_hours"],
					optional_fields: ["email", "location", "office_hours"],
					required_evidence: ["phone"],
					required_fields: ["organization_name", "source_url", "source_version_evidence"],
					selected_write_target: "campus_services/contact_directory",
					source_hosts: ["www.muc.edu.cn"],
					source_urls: ["https://www.muc.edu.cn/"],
					target_label: "联系信息测试",
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
			inventoryId: "contact-missing-family-evidence",
			promotionDecision: "staged",
			rawAssetId: "owasset_contact",
			rawVersionId: "owver_contact",
			sourceObjectKeys: ["official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"],
			targetAttemptId: "owattempt_contact",
			targetJobId: "owtarget_contact",
		};

		const report = buildOfficialWebTargetInventoryReportFromInventory(inventory, {
			fieldStatusByInventoryId: {
				"contact-missing-family-evidence": {
					organization_name: "present",
					source_url: "present",
					source_version_evidence: "present",
				},
			},
			previewEvidence: [evidence],
		});

		expect(report.entries[0]).toMatchObject({
			fieldStatus: expect.objectContaining({
				email: "source_not_provided",
				location: "source_not_provided",
				office_hours: "source_not_provided",
				phone: "missing",
			}),
			optionalEvidence: ["email", "location", "office_hours"],
			releaseBlockers: expect.arrayContaining(["missing_phone"]),
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
			candidate: 35,
			previewed: 1,
		});
	});

	it("includes newly admitted email service, met contact, and public regulation targets", () => {
		const config = loadOfficialWebConfig("muc_public");
		const inventoryIds = config.targetInventory.entries.map((entry) => entry.inventoryId);

		expect(inventoryIds).toEqual(
			expect.arrayContaining([
				"muc-it-network-auth-service-guide",
				"muc-it-vpn-service-guide",
				"muc-it-email-service-guide",
				"muc-it-password-reset-service-guide",
				"muc-it-network-account-management-guide",
				"muc-it-staff-campus-card-service-guide",
				"muc-it-enterprise-wechat-guide",
				"muc-it-enterprise-wechat-faq-guide",
				"muc-it-enterprise-wechat-phone-update-guide",
				"muc-it-directory-lookup-guide",
				"muc-it-academic-calendar-guide",
				"muc-it-service-contacts",
				"muc-logistics-service-contacts",
				"muc-it-email-policy-reference",
				"muc-it-information-system-management-policy-reference",
				"muc-it-network-security-policy-reference",
				"muc-it-campus-network-account-policy-reference",
				"muc-it-campus-card-policy-reference",
				"muc-it-information-portal-policy-reference",
				"muc-it-office-automation-policy-reference",
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
					optional_evidence: ["service_entry", "service_material"],
					optional_fields: ["service_entry", "required_materials"],
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
					optionalEvidence: ["service_entry", "service_material"],
					optionalFields: ["service_entry", "required_materials"],
					requiredFields: ["service_name"],
					reviewState: "candidate",
				},
			],
			inventoryVersion: "test_inventory_v1",
			siteId: "muc_public",
		});
	});
});
