// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildExpectedTableSpecs,
	loadMigrationContext,
} from "../scripts/adopt-shared-database.mjs";
import { buildCurrentSharedDatabaseExpectedTableSpecs } from "../scripts/shared-product-current-schema.mjs";

const migrationContext = loadMigrationContext();

describe("app-api shared product current schema", () => {
	it("supplements drizzle snapshots with shared-product tables that are current repo truth", () => {
		const drizzleSpecs = buildExpectedTableSpecs(migrationContext.latestSnapshot);
		const currentSpecs = buildCurrentSharedDatabaseExpectedTableSpecs(
			migrationContext.latestSnapshot,
		);

		expect(drizzleSpecs.has("dining.review_projections")).toBe(false);
		expect(
			[...currentSpecs.keys()].filter((qualifiedName) => !drizzleSpecs.has(qualifiedName)),
		).toEqual(["dining.review_projections"]);
		expect(currentSpecs.get("dining.review_projections")).toMatchObject({
			schema: "dining",
			table: "review_projections",
		});
		expect(
			currentSpecs.get("dining.review_projections")?.columns.get("stall_profile_id"),
		).toMatchObject({
			name: "stall_profile_id",
			notNull: true,
			type: "text",
		});
		expect(currentSpecs.get("dining.review_projections")?.columns.get("window_id")).toMatchObject({
			name: "window_id",
			notNull: true,
			type: "text",
		});
		expect([...(currentSpecs.get("dining.review_projections")?.indexes.keys() ?? [])]).toEqual(
			expect.arrayContaining([
				"dining_review_projections_hall_idx",
				"dining_review_projections_source_record_idx",
				"dining_review_projections_stall_profile_idx",
				"dining_review_projections_window_idx",
			]),
		);
		expect(currentSpecs.get("dining.menu_offerings")?.columns.get("price_label")).toMatchObject({
			notNull: false,
			type: "text",
		});
	});
});
