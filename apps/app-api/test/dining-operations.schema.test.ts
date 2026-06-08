// @vitest-environment node

import { describe, expect, it } from "vitest";

import { appApiSchema } from "../src/db/schema";

describe("dining operations schema", () => {
	it("exports app-owned dining operations tables through appApiSchema", () => {
		expect(Object.keys(appApiSchema)).toEqual(
			expect.arrayContaining([
				"diningAuditEvents",
				"diningFloors",
				"diningHalls",
				"diningMenuItems",
				"diningMenuOfferings",
				"diningReleaseSnapshots",
				"diningReleases",
				"diningSourceObservations",
				"diningStallProfiles",
				"diningWindowAssignments",
				"diningWindows",
			]),
		);
	});
});
