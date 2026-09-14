import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareHistory, readHistory } from "../src/history.ts";

import {
	assertLegacyObjectsAbsent,
	legacyObjects,
	readDatabaseConfig,
	withSchemaMigrationLock,
} from "../src/migrate.ts";

const jobRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the baseline is a schema-only unified migration", async () => {
	const baseline = await readFile(
		resolve(jobRoot, "migrations/20260827151741_0000_campus_agent_baseline/migration.sql"),
		"utf8",
	);
	assert.doesNotMatch(baseline, /\\(?:restrict|unrestrict)/u);
	assert.doesNotMatch(baseline, /CREATE SCHEMA drizzle/u);
	for (const legacyObject of legacyObjects) {
		assert.doesNotMatch(baseline, new RegExp(escapeRegExp(legacyObject), "u"));
	}
	assert.match(baseline, /CREATE SCHEMA app_auth/u);
	assert.match(baseline, /CREATE TABLE campus_docs_serving\.current_index/u);
	assert.match(baseline, /CREATE TABLE notices\.categories/u);
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

test("released v0 history maps uniquely without changing SQL", async () => {
	const history = readHistory(resolve(jobRoot, "migrations"));
	const fixture = JSON.parse(
		await readFile(new URL("fixtures/v0-history.json", import.meta.url), "utf8"),
	);
	assert.deepEqual(
		compareHistory(
			history,
			fixture.map((row: object, index: number) => ({ ...row, id: index + 1 })),
			false,
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

test("legacy object check reports only objects returned by PostgreSQL", async () => {
	const client = {
		async query<T extends object>(
			_query: string,
			_values?: readonly unknown[],
		): Promise<{ rows: T[] }> {
			return { rows: [{ object_name: "execution_config" } as T] };
		},
	};
	await assert.rejects(
		assertLegacyObjectsAbsent(client),
		/legacy database objects are still present: execution_config/u,
	);
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
