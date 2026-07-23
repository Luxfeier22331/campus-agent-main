import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
	resolve(import.meta.dirname, "../drizzle/0000_dining.sql"),
	"utf8",
);

describe("Dining database migration", () => {
	it("installs the catalog, publication, source, review, and operations tables", () => {
		for (const table of [
			"halls",
			"floors",
			"windows",
			"stall_profiles",
			"window_assignments",
			"menu_items",
			"menu_offerings",
			"catalog_state",
			"releases",
			"publication",
			"source_sync_runs",
			"source_observations",
			"catalog_overrides",
			"reviews",
			"review_overrides",
			"review_recheck_requests",
			"operation_events",
		]) {
			expect(migrationSql).toContain(`CREATE TABLE "dining"."${table}"`);
		}
	});

	it("contains the new constraints and no retired projection lifecycle", () => {
		expect(migrationSql).toContain("dining_reviews_publication_check");
		expect(migrationSql).toContain("dining_review_recheck_active_uidx");
		expect(migrationSql).toContain("dining_floors_hall_floor_unique");
		for (const retired of [
			"release_candidates",
			"release_candidate_validation_reports",
			"release_latest_pointer",
			"release_snapshots",
			"review_projections",
			"public.dining_migrations",
		]) {
			expect(migrationSql).not.toContain(retired);
		}
	});
});
