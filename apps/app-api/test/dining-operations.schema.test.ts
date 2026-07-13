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
		const sql = readAppFile("drizzle/0000_initial.sql");

		for (const requiredFragment of [
			'"floorplan_id" text',
			'"floorplan_sha256" text',
			'CREATE TABLE "dining"."draft_versions"',
			'CREATE TABLE "dining"."release_candidates"',
			'"snapshot_payload_json" jsonb NOT NULL',
			'CREATE TABLE "dining"."release_candidate_validation_reports"',
			'CREATE TABLE "dining"."release_schedule_jobs"',
			'CREATE TABLE "dining"."release_latest_pointer"',
			'"svg_anchor_id" text',
			'"snapshot_hash" text',
			"\"svg_object_refs_json\" jsonb DEFAULT '[]'::jsonb NOT NULL",
		]) {
			expect(sql).toContain(requiredFragment);
		}
	});

	it("keeps dining floorplan manifest refs in the current baseline", () => {
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0000_snapshot.json")) as {
			tables: Record<
				string,
				{ columns: Record<string, { name: string; notNull: boolean; type: string }> }
			>;
		};
		const floorColumns = latestSnapshot.tables["dining.floors"]?.columns ?? {};

		expect(floorColumns.floorplan_id).toMatchObject({
			name: "floorplan_id",
			notNull: true,
			type: "text",
		});
		expect(floorColumns.floorplan_sha256).toMatchObject({
			name: "floorplan_sha256",
			notNull: true,
			type: "text",
		});
		expect(latestSnapshot.tables["dining.floorplan_assets"]).toBeUndefined();
	});

	it("keeps dining menu offering price labels nullable for incomplete source prices", () => {
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0000_snapshot.json")) as {
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
	});

	it("keeps dining source observations incremental and replayable", () => {
		const sql = readAppFile("drizzle/0000_initial.sql");
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0000_snapshot.json")) as {
			tables: Record<
				string,
				{ columns: Record<string, { name: string; notNull: boolean; type: string }> }
			>;
		};
		const observationColumns = latestSnapshot.tables["dining.source_observations"]?.columns ?? {};
		const syncRunColumns = latestSnapshot.tables["dining.source_sync_runs"]?.columns ?? {};

		expect(sql).toContain('CREATE TABLE "dining"."source_sync_runs"');
		expect(sql).toContain('"last_seen_run_id" text NOT NULL');
		expect(sql).toContain('"stale_at" timestamp with time zone');
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
		const sql = readAppFile("drizzle/0000_initial.sql");
		const latestSnapshot = JSON.parse(readAppFile("drizzle/meta/0000_snapshot.json")) as {
			tables: Record<
				string,
				{
					columns: Record<string, { name: string; notNull: boolean; type: string }>;
					indexes?: Record<string, unknown>;
				}
			>;
		};
		const reviewTable = latestSnapshot.tables["dining.review_projections"];
		const reviewColumns = reviewTable?.columns ?? {};

		expect(Object.keys(appApiSchema)).toContain("diningReviewProjections");
		expect(sql).toContain('CREATE TABLE "dining"."review_projections"');
		expect(reviewColumns.stall_profile_id).toMatchObject({
			name: "stall_profile_id",
			notNull: true,
			type: "text",
		});
		expect(reviewColumns.window_id).toMatchObject({
			name: "window_id",
			notNull: true,
			type: "text",
		});
		expect(Object.keys(reviewTable?.indexes ?? {})).toEqual(
			expect.arrayContaining([
				"dining_review_projections_stall_profile_idx",
				"dining_review_projections_window_idx",
			]),
		);
	});
});
