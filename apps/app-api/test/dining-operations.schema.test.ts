// @vitest-environment node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { appApiSchema } from "../src/db/schema";
import { appApiOwnedSchema } from "../src/db/schema/owned";

const DINING_TABLE_EXPORTS = [
	"diningAuditEvents",
	"diningDraftVersions",
	"diningFloors",
	"diningHalls",
	"diningMenuItems",
	"diningMenuOfferings",
	"diningReleaseCandidateValidationReports",
	"diningReleaseCandidates",
	"diningReleaseLatestPointer",
	"diningReleaseScheduleJobs",
	"diningReleaseSnapshots",
	"diningReleases",
	"diningSourceSyncRuns",
	"diningSourceObservations",
	"diningStallProfiles",
	"diningWindowAssignments",
	"diningWindows",
];
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readAppFile(relativePath: string): string {
	return readFileSync(join(APP_ROOT, relativePath), "utf8");
}

describe("dining operations schema", () => {
	it("exports app-owned dining operations tables through appApiSchema", () => {
		expect(Object.keys(appApiSchema)).toEqual(expect.arrayContaining(DINING_TABLE_EXPORTS));
	});

	it("keeps dining operations tables in the drizzle-owned schema truth", () => {
		expect(Object.keys(appApiOwnedSchema)).toEqual(expect.arrayContaining(DINING_TABLE_EXPORTS));
	});

	it("keeps shared product bootstrap aligned with candidate-first dining storage", () => {
		const sql = readAppFile("db/shared-product-migrations/0007_dining_operations.sql");

		for (const requiredFragment of [
			'"floorplan_id" text',
			'"floorplan_sha256" text',
			'CREATE TABLE IF NOT EXISTS "dining"."draft_versions"',
			'CREATE TABLE IF NOT EXISTS "dining"."release_candidates"',
			'"snapshot_payload_json" jsonb NOT NULL',
			'CREATE TABLE IF NOT EXISTS "dining"."release_candidate_validation_reports"',
			'CREATE TABLE IF NOT EXISTS "dining"."release_schedule_jobs"',
			'CREATE TABLE IF NOT EXISTS "dining"."release_latest_pointer"',
			'"svg_anchor_id" text',
			'"snapshot_hash" text',
			"\"svg_object_refs_json\" jsonb DEFAULT '[]'::jsonb NOT NULL",
		]) {
			expect(sql).toContain(requiredFragment);
		}
	});

	it("keeps the manifest-ref dining migration safe for pre-existing dining rows", () => {
		const sql = readAppFile("drizzle/0041_dining_floorplan_manifest_refs.sql");

		expect(sql).not.toContain(
			'ALTER TABLE "dining"."floors" ADD COLUMN "floorplan_id" text NOT NULL;',
		);
		expect(sql).toContain('ALTER TABLE "dining"."floors" ADD COLUMN "floorplan_id" text DEFAULT');
		expect(sql).toContain(
			'ALTER TABLE "dining"."floors" ADD COLUMN "floorplan_sha256" text DEFAULT',
		);
		expect(sql).toContain('DROP TABLE "dining"."floorplan_assets"');
	});

	it("keeps dining menu offering price labels nullable for incomplete source prices", () => {
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0055_snapshot.json")) as {
			tables: Record<
				string,
				{ columns: Record<string, { name: string; notNull: boolean; type: string }> }
			>;
		};
		const priceColumn = latestSnapshot.tables["dining.menu_offerings"]?.columns.price_label;

		expect(priceColumn).toMatchObject({
			name: "price_label",
			notNull: false,
			type: "text",
		});
		expect(readAppFile("drizzle/0055_nullable_dining_price_label.sql")).toContain(
			'ALTER TABLE "dining"."menu_offerings" ALTER COLUMN "price_label" DROP NOT NULL',
		);
	});

	it("keeps dining source observations incremental and replayable", () => {
		const migration = readAppFile("drizzle/0056_dining_source_observation_incremental.sql");
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0056_snapshot.json")) as {
			tables: Record<
				string,
				{ columns: Record<string, { name: string; notNull: boolean; type: string }> }
			>;
		};
		const observationColumns = latestSnapshot.tables["dining.source_observations"]?.columns ?? {};
		const syncRunColumns = latestSnapshot.tables["dining.source_sync_runs"]?.columns ?? {};

		expect(migration).toContain('CREATE TABLE IF NOT EXISTS "dining"."source_sync_runs"');
		expect(migration).toContain('"last_seen_run_id" text');
		expect(migration).toContain('"stale_at" timestamp with time zone');
		expect(observationColumns.content_hash).toMatchObject({
			name: "content_hash",
			notNull: true,
			type: "text",
		});
		expect(observationColumns.last_seen_run_id).toMatchObject({
			name: "last_seen_run_id",
			notNull: true,
			type: "text",
		});
		expect(observationColumns.stale_at).toMatchObject({
			name: "stale_at",
			notNull: false,
			type: "timestamp with time zone",
		});
		expect(syncRunColumns.run_id).toMatchObject({
			name: "run_id",
			notNull: true,
			type: "text",
		});
	});

	it("keeps shared dining review projections bound to published stall/window ids", () => {
		const bootstrap = readAppFile(
			"db/shared-product-migrations/0010_dining_review_projections.sql",
		);
		const migration = readAppFile(
			"db/shared-product-migrations/0012_dining_review_binding_ids.sql",
		);

		expect(Object.keys(appApiSchema)).toContain("diningReviewProjections");
		expect(bootstrap).toContain('CREATE TABLE IF NOT EXISTS "dining"."review_projections"');
		expect(migration).toContain('DELETE FROM "dining"."review_projections"');
		expect(migration).toContain('"stall_profile_id" text');
		expect(migration).toContain('"window_id" text');
		expect(migration).toContain('ALTER COLUMN "stall_profile_id" SET NOT NULL');
		expect(migration).toContain('ALTER COLUMN "window_id" SET NOT NULL');
		expect(migration).not.toContain("DEFAULT ''");
		expect(migration).toContain("dining_review_projections_stall_profile_idx");
		expect(migration).toContain("dining_review_projections_window_idx");
	});
});
