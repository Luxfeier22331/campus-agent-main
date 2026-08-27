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
