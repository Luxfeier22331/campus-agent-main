import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareHistory, readHistory } from "../src/history.ts";

import { readDatabaseConfig, withSchemaMigrationLock } from "../src/migrate.ts";

const jobRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the baseline is a schema-only unified migration", async () => {
	const baseline = await readFile(
		resolve(jobRoot, "migrations/20260827151741_0000_campus_agent_baseline/migration.sql"),
		"utf8",
	);
	assert.doesNotMatch(baseline, /\\(?:restrict|unrestrict)/u);
	assert.doesNotMatch(baseline, /CREATE SCHEMA drizzle/u);
	assert.match(baseline, /CREATE SCHEMA app_auth/u);
	assert.match(baseline, /CREATE TABLE campus_docs_serving\.current_index/u);
	assert.match(baseline, /CREATE TABLE notices\.categories/u);
});

test("the agent-control migration renames the live schema without rewriting history", async () => {
	const migration = await readFile(
		resolve(
			jobRoot,
			"migrations/20261014090000_rename_execution_control_to_agent_control/migration.sql",
		),
		"utf8",
	);
	assert.match(migration, /ALTER SCHEMA execution_control RENAME TO agent_control;/u);
	assert.match(migration, /GRANT USAGE ON SCHEMA agent_control TO agent_control;/u);
	assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|CREATE TABLE/u);
});

test("the personal-memory cleanup migration only drops the compatibility views", async () => {
	const migration = await readFile(
		resolve(
			jobRoot,
			"migrations/20260830172703_0002_remove_runtime_personal_memory_compat_views/migration.sql",
		),
		"utf8",
	);
	assert.equal(
		migration.trim(),
		[
			"DROP VIEW runtime.personal_memory_call_leases;",
			"DROP VIEW runtime.personal_memory_command_receipts;",
			"DROP VIEW runtime.personal_memory_owner_fences;",
		].join("\n"),
	);
	assert.doesNotMatch(migration, /CASCADE|IF EXISTS|DROP TABLE|GRANT|REVOKE/u);
});

test("the Ops Web step timing migration grants only the required read columns", async () => {
	const migration = await readFile(
		resolve(
			jobRoot,
			"migrations/20260905233000_0004_grant_ops_web_step_activity_attempt/migration.sql",
		),
		"utf8",
	);
	assert.equal(
		migration.trim(),
		[
			"GRANT SELECT (activity_attempt) ON TABLE execution_control.agent_run_steps TO ops_web;",
			"GRANT SELECT (activity_attempt) ON TABLE execution_control.agent_step_attempts TO ops_web;",
			"GRANT SELECT (updated_at) ON TABLE execution_control.agent_step_attempts TO ops_web;",
		].join("\n"),
	);
	assert.doesNotMatch(migration, /GRANT SELECT ON TABLE|INSERT|UPDATE|DELETE|REVOKE/u);
});

test("released history maps uniquely and leaves unpublished migrations pending", async () => {
	const history = readHistory(resolve(jobRoot, "migrations"));
	const fixture = JSON.parse(
		await readFile(new URL("fixtures/released-history.json", import.meta.url), "utf8"),
	).filter((row: { name: string }) => row.name !== "20260914000000_0016_dining_submissions");
	assert.deepEqual(
		compareHistory(
			history,
			fixture.map((row: object, index: number) => ({ ...row, id: index + 1 })),
		),
		history
			.filter(
				(entry) => !fixture.some((released: { name: string }) => released.name === entry.name),
			)
			.map((entry) => entry.name),
	);
});

test("database configuration uses the standard PostgreSQL environment", () => {
	const config = readDatabaseConfig({
		PGDATABASE: "campus_agent",
		PGHOST: "127.0.0.1",
		PGPASSWORD: "secret",
		PGPORT: "5432",
		PGSSLMODE: "disable",
		PGUSER: "campus_agent",
	});
	assert.deepEqual(config, {
		database: "campus_agent",
		host: "127.0.0.1",
		password: "secret",
		port: 5432,
		ssl: false,
		user: "campus_agent",
	});
});

test("schema migration lock is released after success and failure", async () => {
	const queries: string[] = [];
	const client = {
		async query<T extends object = object>(query: string): Promise<{ rows: T[] }> {
			queries.push(query);
			return { rows: [] as T[] };
		},
	};
	await withSchemaMigrationLock(client, async () => "done");
	assert.equal(queries.length, 2);
	assert.match(queries[0] ?? "", /pg_advisory_lock/u);
	assert.match(queries[1] ?? "", /pg_advisory_unlock/u);

	queries.length = 0;
	await assert.rejects(
		withSchemaMigrationLock(client, async () => {
			throw new Error("migration failed");
		}),
		/migration failed/u,
	);
	assert.equal(queries.length, 2);
});
