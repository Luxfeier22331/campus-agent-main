import { describe, expect, it } from "vitest";
import { assertIngestionControlPostgresSchema } from "../src/postgres-store";

const columns = [
	"task_id",
	"run_id",
	"registry_task_id",
	"executor_kind",
	"source_family",
	"source_channel",
	"corpus",
	"collection",
	"input_ref_json",
	"input_contract",
	"output_contract",
	"created_by",
	"created_at",
	"status",
	"workflow_id",
	"workflow_run_id",
	"pipeline_workflow_id",
	"retry_of_task_id",
	"updated_at",
	"result_ref_json",
	"result_contract",
	"summary_json",
	"error_code",
	"error_message",
];

const freshnessColumns = [
	"site_id",
	"normalized_canonical_url",
	"host",
	"page_family",
	"page_title_normalized",
	"discovery_method",
	"discovered_from_url",
	"last_fetch_disposition",
	"last_http_status",
	"content_type",
	"etag",
	"last_modified",
	"response_body_hash",
	"main_content_hash",
	"last_seen_at",
	"last_changed_at",
	"last_not_modified_at",
	"cadence_class",
	"priority_score",
	"next_eligible_fetch_at",
	"last_successful_run_id",
	"last_change_reason",
	"created_at",
	"updated_at",
];

const seedStateColumns = [
	"site_id",
	"configured_seed_url",
	"normalized_canonical_url",
	"last_observed_run_id",
	"last_seen_at",
	"created_at",
	"updated_at",
];

const migrationColumns = ["migration_id", "content_sha256", "applied_at"];
const releaseStreamColumns = [
	"stream_id",
	"source_channel",
	"source_surface",
	"corpus",
	"collection",
	"current_release_id",
	"checkpoint_json",
	"version",
	"created_at",
	"updated_at",
	"last_check_at",
	"last_check_mode",
	"last_check_outcome",
	"last_check_error_code",
	"last_reconcile_at",
	"last_published_at",
	"last_added_count",
	"last_updated_count",
	"last_withdrawn_count",
];
const releaseColumns = [
	"release_id",
	"stream_id",
	"previous_release_id",
	"run_id",
	"workflow_id",
	"workflow_run_id",
	"manifest_ref_json",
	"item_count",
	"committed_at",
];

describe("ingestion-control schema assertion", () => {
	it("is read-only and accepts only the migrated task projection", async () => {
		const statements: string[] = [];
		await assertIngestionControlPostgresSchema({
			async query(sql, params) {
				statements.push(sql);
				return {
					rows: schemaColumns(sql, params).map((column_name) => ({ column_name })),
				};
			},
		});
		expect(statements).toHaveLength(6);
		for (const statement of statements) {
			expect(statement).toContain("information_schema.columns");
			expect(statement).not.toMatch(/CREATE|ALTER|DROP/iu);
		}
	});

	it("rejects legacy closeout storage", async () => {
		await expect(
			assertIngestionControlPostgresSchema({
				async query(sql, params) {
					return {
						rows: schemaColumns(sql, params, [...columns, "closeout_json"]).map((column_name) => ({
							column_name,
						})),
					};
				},
			}),
		).rejects.toThrow("retired column: closeout_json");
	});
});

function schemaColumns(sql: string, params?: unknown[], taskColumns = columns): string[] {
	if (sql.includes("schema_migrations")) {
		return migrationColumns;
	}
	if (sql.includes("official_web_url_freshness")) {
		return freshnessColumns;
	}
	if (sql.includes("official_web_seed_state")) {
		return seedStateColumns;
	}
	if (params?.[0] === "offline_release_streams") {
		return releaseStreamColumns;
	}
	if (params?.[0] === "offline_releases") {
		return releaseColumns;
	}
	return taskColumns;
}
