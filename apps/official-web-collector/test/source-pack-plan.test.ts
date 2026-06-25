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
		expect(plan.rows.map((row) => row.entryId)).toContain("owsp-public-academic-calendar-mdxl");
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

	it("keeps email policy composition rows on the institutional-rules target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-email-policy-1090",
		) as SourcePackExecutionPlanEntry;

		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			compositionGroup: "email_service",
			compositionRole: "policy_source",
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "owsp-email-policy-1090",
		});
	});

	it("admits the public academic calendar page on the academic-calendar target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "owsp-public-academic-calendar-mdxl",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.muc.edu.cn/ggfw/mdxl.htm");
		expect(row.ownerSurfaces).toEqual(["calendar/academic_calendar"]);
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

	it("builds the public regulation closeout pack with direct regulation rows and listing expansion rows", () => {
		const plan = buildSourcePackExecutionPlan("muc_public", {
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});
		const directRow = plan.rows.find(
			(item) => item.entryId === "owsp-closeout-it-campus-card-policy-1086",
		) as SourcePackExecutionPlanEntry;
		const staffGovernanceRow = plan.rows.find(
			(item) => item.entryId === "owsp-closeout-staff-title-review-policy-5731",
		) as SourcePackExecutionPlanEntry;
		const studentRuleRow = plan.rows.find(
			(item) => item.entryId === "owsp-closeout-student-major-transfer-policy-4911",
		) as SourcePackExecutionPlanEntry;
		const listingRow = plan.rows.find(
			(item) => item.entryId === "owsp-closeout-student-rules-jlycf-listing",
		) as SourcePackExecutionPlanEntry;

		expect(plan.sourcePackId).toBe("official-web-public-regulation-closeout.v1");
		expect(plan.entryCount).toBe(29);

		expect(directRow.answerBearing).toBe(true);
		expect(directRow.url).toBe("https://met.muc.edu.cn/info/1024/1086.htm");
		expect(directRow.ownerSurfaces).toEqual(["regulations/institutional_rules"]);
		expect(directRow.releaseTargets).toEqual(["regulations/institutional_rules"]);
		expect(directRow.targetMatches).toHaveLength(1);
		expect(directRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "owsp-closeout-it-campus-card-policy-1086",
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});

		expect(staffGovernanceRow.answerBearing).toBe(true);
		expect(staffGovernanceRow.url).toBe("https://xxgk.muc.edu.cn/info/1290/5731.htm");
		expect(staffGovernanceRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "owsp-closeout-staff-title-review-policy-5731",
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});

		expect(studentRuleRow.answerBearing).toBe(true);
		expect(studentRuleRow.url).toBe("https://xxgk.muc.edu.cn/info/1247/4911.htm");
		expect(studentRuleRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			selectedWriteTarget: "regulations/student_rules",
			sourcePackEntryId: "owsp-closeout-student-major-transfer-policy-4911",
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});

		expect(listingRow.answerBearing).toBe(false);
		expect(listingRow.targetWorksetExpansion).toBe("same_host_manual_requeue");
		expect(listingRow.ownerSurfaces).toEqual(["regulations/student_rules"]);
		expect(listingRow.releaseTargets).toEqual(["regulations/student_rules"]);
		expect(listingRow.targetMatches).toHaveLength(1);
		expect(listingRow.targetMatches[0]).toMatchObject({
			targetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			selectedWriteTarget: "regulations/student_rules",
			sourcePackEntryId: "owsp-closeout-student-rules-jlycf-listing",
			sourcePackId: "official-web-public-regulation-closeout.v1",
		});
	});
});
