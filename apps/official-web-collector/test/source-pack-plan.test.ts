import { describe, expect, it } from "vitest";

import {
	buildSourcePackExecutionPlan,
	type SourcePackExecutionPlanEntry,
} from "../src/source-pack-plan";
import { writeTestConfigRoot } from "./test-support";

describe("official web source-pack execution plan", () => {
	it("builds one deterministic execution row per manifest entry", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");

		expect(plan.siteId).toBe("muc_public");
		expect(plan.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(plan.entryCount).toBeGreaterThan(0);
		expect(plan.rows.map((row) => row.entryId)).toContain("owsp-campus-card-met-1127");
	});

	it("preserves multi-owner fanout in execution metadata without duplicating fetch rows", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-campus-card-met-1127",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://met.muc.edu.cn/info/1027/1127.htm");
		expect(row.host).toBe("met.muc.edu.cn");
		expect(row.ownerSurfaces).toEqual(["service_guide_lookup", "contact_directory_lookup"]);
		expect(row.releaseTargets).toEqual([
			"campus_services/service_guide",
			"campus_services/contact_directory",
		]);
		expect(row.targetMatches.map((match) => match.targetId).sort()).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
		]);
	});

	it("includes the logistics contact row as a contact-directory-only source-pack target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-logistics-contact-hqfw",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.muc.edu.cn/ggfw/hqfw.htm");
		expect(row.ownerSurfaces).toEqual(["contact_directory_lookup"]);
		expect(row.releaseTargets).toEqual(["campus_services/contact_directory"]);
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "campus-services-contact-directory",
			consumerFamily: "contact_directory_candidate",
			selectedWriteTarget: "campus_services/contact_directory",
			sourcePackEntryId: "owsp-logistics-contact-hqfw",
		});
	});

	it("includes stable-reference rows for library and museum public reference pages", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const libraryRow = plan.rows.find(
			(item) => item.entryId === "owsp-library-reference-tsg",
		) as SourcePackExecutionPlanEntry;
		const museumRow = plan.rows.find(
			(item) => item.entryId === "owsp-museum-reference-mzbwg",
		) as SourcePackExecutionPlanEntry;

		expect(libraryRow.url).toBe("https://www.muc.edu.cn/ggfw/tsg.htm");
		expect(libraryRow.ownerSurfaces).toEqual(["official_web/stable_reference"]);
		expect(libraryRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-stable-reference",
			sourcePackEntryId: "owsp-library-reference-tsg",
		});

		expect(museumRow.url).toBe("https://www.muc.edu.cn/ggfw/mzbwg.htm");
		expect(museumRow.ownerSurfaces).toEqual(["official_web/stable_reference"]);
		expect(museumRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-stable-reference",
			sourcePackEntryId: "owsp-museum-reference-mzbwg",
		});
	});

	it("maps stable-reference policy rows to a canonical admitted target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-info-disclosure-policy-1107",
		) as SourcePackExecutionPlanEntry;

		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			compositionGroup: "information_disclosure",
			compositionRole: "policy_source",
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "owsp-info-disclosure-policy-1107",
			sourcePackId: "tool-driven-first-slice.v1",
		});
	});

	it("keeps email service composition rows on the service-guide target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-email-policy-1090",
		) as SourcePackExecutionPlanEntry;

		expect(row.targetMatches).toHaveLength(2);
		expect(
			row.targetMatches.find((item) => item.targetId === "campus-services-service-guide"),
		).toMatchObject({
			compositionGroup: "email_service",
			compositionRole: "policy_source",
			targetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			selectedWriteTarget: "campus_services/service_guide",
			sourcePackEntryId: "owsp-email-policy-1090",
		});
		expect(
			row.targetMatches.find((item) => item.targetId === "official-web-institutional-rules"),
		).toMatchObject({
			compositionGroup: "email_service",
			compositionRole: "policy_source",
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "owsp-email-policy-1090",
		});
	});

	it("admits the identity password reset guide on the service-guide target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-password-reset-1830",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://met.muc.edu.cn/info/1068/1830.htm");
		expect(row.ownerSurfaces).toEqual(["service_guide_lookup"]);
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "campus-services-service-guide",
			consumerFamily: "service_guide_candidate",
			selectedWriteTarget: "campus_services/service_guide",
			sourcePackEntryId: "owsp-password-reset-1830",
		});
	});

	it("admits newly added met service-guide pages on the service-guide target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");

		for (const entryId of [
			"owsp-network-account-1106",
			"owsp-staff-campus-card-1107",
			"owsp-enterprise-wechat-1828",
			"owsp-enterprise-wechat-faq-2499",
			"owsp-enterprise-wechat-phone-update-2669",
			"owsp-directory-lookup-1831",
			"owsp-academic-calendar-guide-1832",
		]) {
			const row = plan.rows.find(
				(item) => item.entryId === entryId,
			) as SourcePackExecutionPlanEntry;

			expect(row.ownerSurfaces).toContain("service_guide_lookup");
			expect(row.releaseTargets).toContain("campus_services/service_guide");
			expect(
				row.targetMatches.find((item) => item.targetId === "campus-services-service-guide"),
			).toMatchObject({
				targetId: "campus-services-service-guide",
				consumerFamily: "service_guide_candidate",
				selectedWriteTarget: "campus_services/service_guide",
				sourcePackEntryId: entryId,
			});
		}
	});

	it("admits the public academic calendar page on the academic-calendar target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-public-academic-calendar-mdxl",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.muc.edu.cn/ggfw/mdxl.htm");
		expect(row.ownerSurfaces).toEqual(["academic_calendar_lookup"]);
		expect(row.releaseTargets).toEqual(["calendar/academic_calendar"]);
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-academic-calendar",
			consumerFamily: "academic_calendar_candidate",
			selectedWriteTarget: "calendar/academic_calendar",
			sourcePackEntryId: "owsp-public-academic-calendar-mdxl",
		});
	});

	it("admits newly added met regulation pages on the institutional-rules target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");

		for (const entryId of [
			"owsp-it-information-system-management-policy-1085",
			"owsp-it-network-security-policy-1188",
			"owsp-it-campus-network-account-policy-1084",
			"owsp-it-campus-card-policy-1086",
			"owsp-it-information-portal-policy-1088",
			"owsp-it-office-automation-policy-1089",
			"owsp-it-secondary-website-policy-1091",
			"owsp-it-campus-network-access-policy-1083",
		]) {
			const row = plan.rows.find(
				(item) => item.entryId === entryId,
			) as SourcePackExecutionPlanEntry;
			expect(row.ownerSurfaces).toContain("regulations/institutional_rules");
			expect(row.releaseTargets).toContain("regulations/institutional_rules");
			expect(
				row.targetMatches.find((item) => item.targetId === "official-web-institutional-rules"),
			).toMatchObject({
				targetId: "official-web-institutional-rules",
				consumerFamily: "regulation_candidate",
				selectedWriteTarget: "regulations/institutional_rules",
				sourcePackEntryId: entryId,
			});
		}
	});

	it("preserves target-workset discovery expansion metadata for non-answer-bearing source-pack rows", () => {
		const plan = buildSourcePackExecutionPlan("campus_public", {
			configRoot: writeTestConfigRoot().configRoot,
		});
		const row = plan.rows.find(
			(item) => item.entryId === "institutional-rules-column",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/rules/");
		expect(row.answerBearing).toBe(false);
		expect(row.targetWorksetExpansion).toBe("same_host_manual_requeue");
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-institutional-rules",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "institutional-rules-column",
		});
	});

	it("maps student regulation discovery rows to the student-rules target", () => {
		const plan = buildSourcePackExecutionPlan("campus_public", {
			configRoot: writeTestConfigRoot().configRoot,
		});
		const row = plan.rows.find(
			(item) => item.entryId === "student-rules-column",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/xsgz/jwgl");
		expect(row.answerBearing).toBe(false);
		expect(row.ownerSurfaces).toEqual(["regulations/student_rules"]);
		expect(row.releaseTargets).toEqual(["regulations/student_rules"]);
		expect(row.targetWorksetExpansion).toBe("same_host_manual_requeue");
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			selectedWriteTarget: "regulations/student_rules",
			sourcePackEntryId: "student-rules-column",
		});
	});
});
