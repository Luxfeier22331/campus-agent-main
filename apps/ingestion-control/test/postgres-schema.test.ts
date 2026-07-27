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
	"retry_of_task_id",
	"updated_at",
	"result_ref_json",
	"result_contract",
	"summary_json",
	"error_code",
	"error_message",
];

const migrationColumns = ["migration_id", "content_sha256", "applied_at"];
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
		expect(statements).toHaveLength(2);
		for (const statement of statements) {
			expect(statement).toContain("information_schema.columns");
			expect(statement).not.toMatch(/CREATE|ALTER|DROP/iu);
		}
	});
});

function schemaColumns(sql: string, _params?: unknown[], taskColumns = columns): string[] {
	if (sql.includes("schema_migrations")) {
		return migrationColumns;
	}
	return taskColumns;
}
