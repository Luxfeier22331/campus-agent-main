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
		expect(row.ownerSurfaces).toEqual([
			"service_guide_lookup",
			"contact_directory_lookup",
		]);
		expect(row.releaseTargets).toEqual([
			"campus_services/service_guide",
			"campus_services/contact_directory",
		]);
		expect(row.targetMatches.map((match) => match.targetId).sort()).toEqual([
			"campus-services-contact-directory",
			"campus-services-service-guide",
		]);
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
			targetId: "official-web-stable-reference",
			consumerFamily: "stable_reference_candidate",
			selectedWriteTarget: "official_web/stable_reference",
			sourcePackEntryId: "owsp-info-disclosure-policy-1107",
			sourcePackId: "tool-driven-first-slice.v1",
		});
	});
});
