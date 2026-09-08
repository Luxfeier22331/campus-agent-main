import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
	assertLegacyObjectsAbsent,
	legacyObjects,
	readDatabaseConfig,
	withSchemaMigrationLock,
} from "../src/migrate.ts";

const jobRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the baseline is a schema-only unified migration", async () => {
	const baseline = await readFile(resolve(jobRoot, "migrations/0000_campus_agent_baseline.sql"), "utf8");
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
		resolve(jobRoot, "migrations/0002_remove_runtime_personal_memory_compat_views.sql"),
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
		resolve(jobRoot, "migrations/0004_grant_ops_web_step_activity_attempt.sql"),
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

test("the migration journal records the compatibility-view cleanup after existing migrations", async () => {
	const journal = JSON.parse(
		await readFile(resolve(jobRoot, "migrations/meta/_journal.json"), "utf8"),
	) as {
		entries?: Array<{ idx?: number; tag?: string }>;
	};
	const cleanupEntry = journal.entries?.find(
		(entry) => entry.tag === "0002_remove_runtime_personal_memory_compat_views",
	);
	assert.equal(cleanupEntry?.idx, 2);
	assert.equal(cleanupEntry?.tag, "0002_remove_runtime_personal_memory_compat_views");
	const timingEntry = journal.entries?.find(
		(entry) => entry.tag === "0004_grant_ops_web_step_activity_attempt",
	);
	assert.equal(timingEntry?.idx, 4);
	assert.equal(timingEntry?.tag, "0004_grant_ops_web_step_activity_attempt");
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
		async query<T extends object = object>(
			query: string,
		): Promise<{ rows: T[] }> {
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
