import { describe, expect, it } from "vitest";

import {
	buildSourcePackExecutionPlan,
	type SourcePackExecutionPlanEntry,
} from "../src/source-pack-plan";

describe("official web source-pack execution plan", () => {
	it("builds one deterministic execution row per manifest entry", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");

		expect(plan.siteId).toBe("muc_public");
		expect(plan.sourcePackId).toBe("tool-driven-first-slice.v1");
		expect(plan.entryCount).toBe(5);
		expect(plan.rows.map((row) => row.entryId)).toEqual([
			"synthetic-academic-calendar",
			"synthetic-stable-reference",
			"synthetic-institutional-rule",
			"synthetic-institutional-rules-column",
			"synthetic-student-rules-column",
		]);
	});

	it("admits the synthetic stable-reference row on the stable-reference target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "synthetic-stable-reference",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/about");
		expect(row.ownerSurfaces).toEqual(["official_web/stable_reference"]);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-stable-reference",
			sourcePackEntryId: "synthetic-stable-reference",
		});
	});

	it("maps synthetic policy rows to a canonical admitted target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "synthetic-institutional-rule",
		) as SourcePackExecutionPlanEntry;

		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			compositionGroup: "synthetic_policy",
			compositionRole: "policy_source",
			targetId: "official-web-institutional-rules",
			consumerFamily: "regulation_candidate",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "synthetic-institutional-rule",
			sourcePackId: "tool-driven-first-slice.v1",
		});
	});

	it("admits the synthetic academic calendar page on the academic-calendar target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "synthetic-academic-calendar",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/calendar");
		expect(row.ownerSurfaces).toEqual(["calendar/academic_calendar"]);
		expect(row.releaseTargets).toEqual(["calendar/academic_calendar"]);
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-academic-calendar",
			consumerFamily: "academic_calendar_candidate",
			selectedWriteTarget: "calendar/academic_calendar",
			sourcePackEntryId: "synthetic-academic-calendar",
		});
	});

	it("preserves target-workset discovery expansion metadata for non-answer-bearing source-pack rows", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "synthetic-institutional-rules-column",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/rules/");
		expect(row.answerBearing).toBe(false);
		expect(row.targetWorksetExpansion).toBe("same_host_manual_requeue");
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-institutional-rules",
			selectedWriteTarget: "regulations/institutional_rules",
			sourcePackEntryId: "synthetic-institutional-rules-column",
		});
	});

	it("maps student regulation discovery rows to the student-rules target", () => {
		const plan = buildSourcePackExecutionPlan("muc_public");
		const row = plan.rows.find(
			(item) => item.entryId === "synthetic-student-rules-column",
		) as SourcePackExecutionPlanEntry;

		expect(row.url).toBe("https://www.example.edu/students/");
		expect(row.answerBearing).toBe(false);
		expect(row.ownerSurfaces).toEqual(["regulations/student_rules"]);
		expect(row.releaseTargets).toEqual(["regulations/student_rules"]);
		expect(row.targetWorksetExpansion).toBe("same_host_manual_requeue");
		expect(row.targetMatches).toHaveLength(1);
		expect(row.targetMatches[0]).toMatchObject({
			targetId: "official-web-student-rules",
			consumerFamily: "student_regulation_candidate",
			selectedWriteTarget: "regulations/student_rules",
			sourcePackEntryId: "synthetic-student-rules-column",
		});
	});
});
