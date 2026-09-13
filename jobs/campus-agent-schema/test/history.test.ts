import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { compareHistory, createMigration, readHistory } from "../src/history.ts";
import { MIGRATIONS_FOLDER } from "../src/migrate.ts";

test("new creates readable SQL history without a database or overwriting a collision", async (t) => {
	const folder = await mkdtemp(join(tmpdir(), "campus-schema-new-"));
	t.after(() => rm(folder, { recursive: true, force: true }));
	const now = new Date("2026-09-13T08:00:00.123Z");
	const file = createMigration(folder, "add_example_column", now);
	assert.equal(basename(dirname(file)), "20260913080000_add_example_column");
	const original = await readFile(file, "utf8");
	assert.throws(() => createMigration(folder, "add_example_column", now), /EEXIST/u);
	assert.equal(await readFile(file, "utf8"), original);
	assert.deepEqual(
		readHistory(folder).map((entry) => entry.name),
		[basename(dirname(file))],
	);
	assert.throws(() => createMigration(folder, "../escape", now), /Migration name/u);
});

test("malformed history fails before a database is used", async (t) => {
	const folder = await mkdtemp(join(tmpdir(), "campus-schema-invalid-"));
	t.after(() => rm(folder, { recursive: true, force: true }));
	assert.throws(() => readHistory(folder), /history is empty/u);
	await mkdir(join(folder, "20260913080000_missing_sql"));
	assert.throws(() => readHistory(folder), /Missing SQL/u);
});

test("duplicate records and conflicting legacy timestamp mappings are rejected", () => {
	const history = readHistory(MIGRATIONS_FOLDER);
	const first = history[0];
	const second = history[1];
	assert(first && second);
	const row = { id: 1, name: first.name, hash: first.hash, created_at: String(first.folderMillis) };
	assert.throws(
		() => compareHistory(history, [row, { ...row, id: 2 }], true),
		/Duplicate applied/u,
	);
	assert.throws(
		() => compareHistory(history, [{ ...row, created_at: String(second.folderMillis) }], false),
		/mapping conflict/u,
	);
});
