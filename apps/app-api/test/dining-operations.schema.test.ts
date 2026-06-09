// @vitest-environment node

import { describe, expect, it } from "vitest";

import { appApiSchema } from "../src/db/schema";
import { appApiOwnedSchema } from "../src/db/schema/owned";

const DINING_TABLE_EXPORTS = [
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
];

describe("dining operations schema", () => {
	it("exports app-owned dining operations tables through appApiSchema", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(DINING_TABLE_EXPORTS));
	});

	it("keeps dining operations tables in the drizzle-owned schema truth", () => {
		expect(Object.keys(appApiOwnedSchema)).toEqual(expect.arrayContaining(DINING_TABLE_EXPORTS));
	});
});
