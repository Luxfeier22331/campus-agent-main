import { describe, expect, it } from "vitest";
import {
	applyIngestionControlMigrations,
	assertIngestionControlMigrationRole,
	type IngestionControlMigration,
} from "../src/migrate";

const migration: IngestionControlMigration = {
	contentSha256: "a".repeat(64),
	migrationId: "0001_tasks.sql",
	sql: "CREATE TABLE ingestion_control.tasks (task_id text PRIMARY KEY)",
};

describe("ingestion-control migrations", () => {
	it("accepts the schema owner without requiring runtime-role membership", () => {
		expect(() => assertIngestionControlMigrationRole("campus_agent")).not.toThrow();
		expect(() => assertIngestionControlMigrationRole("ingestion_control")).toThrow(
			"cannot run as the runtime role",
		);
	});

	it("applies and journals a new migration in one transaction", async () => {
		const calls: Array<{ params?: unknown[]; sql: string }> = [];
		const applied = await applyIngestionControlMigrations(
			{
				async query(sql, params) {
					calls.push({ ...(params ? { params } : {}), sql });
					return { rows: [] };
				},
			},
			[migration],
		);

		expect(applied).toEqual(["0001_tasks.sql"]);
		expect(calls.map(({ sql }) => sql)).toEqual([
			"BEGIN",
			"SET LOCAL lock_timeout = '30s'",
			expect.stringContaining("pg_advisory_xact_lock"),
			expect.stringContaining("CREATE TABLE IF NOT EXISTS ingestion_control.schema_migrations"),
			expect.stringContaining("SELECT content_sha256"),
			migration.sql,
			expect.stringContaining("INSERT INTO ingestion_control.schema_migrations"),
			"REVOKE ALL ON SCHEMA ingestion_control FROM PUBLIC, ingestion_control",
			"GRANT USAGE ON SCHEMA ingestion_control TO ingestion_control",
			"REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ingestion_control FROM PUBLIC, ingestion_control",
			"REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ingestion_control FROM PUBLIC, ingestion_control",
			expect.stringContaining("ingestion_control.internal_portal_credentials"),
			"COMMIT",
		]);
	});

	it("skips an already-applied migration with the same digest", async () => {
		const calls: string[] = [];
		const applied = await applyIngestionControlMigrations(
			{
				async query(sql) {
					calls.push(sql);
					return {
						rows: sql.includes("SELECT content_sha256")
							? [{ content_sha256: migration.contentSha256 }]
							: [],
					};
				},
			},
			[migration],
		);

		expect(applied).toEqual([]);
		expect(calls).not.toContain(migration.sql);
		expect(calls.at(-1)).toBe("COMMIT");
	});

	it("rolls back when an applied migration digest changed", async () => {
		const calls: string[] = [];

		await expect(
			applyIngestionControlMigrations(
				{
					async query(sql) {
						calls.push(sql);
						return {
							rows: sql.includes("SELECT content_sha256")
								? [{ content_sha256: "b".repeat(64) }]
								: [],
						};
					},
				},
				[migration],
			),
		).rejects.toThrow("migration was modified after apply");
		expect(calls.at(-1)).toBe("ROLLBACK");
	});
});
