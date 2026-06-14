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
});
