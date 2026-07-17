import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
	resolve(import.meta.dirname, "../migrations/0001_dining.sql"),
	"utf8",
);

describe("Dining database migration", () => {
	it("installs the normalized catalog, publication, source, review, and operations surfaces", () => {
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
			expect(migrationSql).toContain(`CREATE TABLE dining.${table}`);
		}
	});

	it("does not restore the retired candidate or projection lifecycle", () => {
		for (const retired of [
			"release_candidates",
			"release_candidate_validation_reports",
			"release_latest_pointer",
			"release_snapshots",
			"review_projections",
		]) {
			expect(migrationSql).not.toContain(retired);
		}
	});

	it("separates public reads, operations writes, and sync writes by role", () => {
		expect(migrationSql).toContain(
			"GRANT SELECT ON dining.publication, dining.releases, dining.reviews TO app_api",
		);
		expect(migrationSql).toContain("GRANT SELECT ON ALL TABLES IN SCHEMA dining TO ops_web_dining");
		expect(migrationSql).toContain("REVOKE CREATE ON SCHEMA dining FROM ops_web_dining");
		expect(migrationSql).toContain("REVOKE CREATE ON SCHEMA dining FROM dining_sync");
		expect(migrationSql).not.toContain("GRANT CREATE ON SCHEMA dining TO dining_sync");
	});
});
