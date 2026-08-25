import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkAppApiMigrationHistory } from "./app-api-migration-history.mts";

const SCRIPT_PATH = path.resolve(import.meta.dirname, "app-api-migration-history.mts");

interface Entry {
	breakpoints: boolean;
	idx: number;
	tag: string;
	version: string;
	when: number;
}

interface Fixture {
	base: string;
	commit(message: string): Promise<string>;
	repositoryRoot: string;
	writeJournal(entries: Entry[]): Promise<void>;
	writeMigration(entry: Entry, sql?: string, snapshot?: string): Promise<void>;
}

function git(repositoryRoot: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function entry(idx: number): Entry {
	return {
		breakpoints: true,
		idx,
		tag: `${String(idx).padStart(4, "0")}_migration_${idx}`,
		version: "7",
		when: 1_000 + idx,
	};
}

async function createFixture(): Promise<Fixture> {
	const repositoryRoot = await mkdtemp(path.join(tmpdir(), "app-api-migration-history-"));
	const drizzleRoot = path.join(repositoryRoot, "apps/app-api/drizzle");
	await mkdir(path.join(drizzleRoot, "meta"), { recursive: true });
	git(repositoryRoot, "init", "--quiet");
	git(repositoryRoot, "config", "user.name", "Migration Test");
	git(repositoryRoot, "config", "user.email", "migration@example.test");
	const writeJournal = async (entries: Entry[]) => {
		await writeFile(
			path.join(drizzleRoot, "meta/_journal.json"),
			`${JSON.stringify({ version: "7", dialect: "postgresql", entries }, null, 2)}\n`,
		);
	};
	const writeMigration = async (
		migration: Entry,
		sql = `select ${migration.idx};\n`,
		snapshot = `${JSON.stringify({ id: migration.tag, prevId: "previous" }, null, 2)}\n`,
	) => {
		await writeFile(path.join(drizzleRoot, `${migration.tag}.sql`), sql);
		await writeFile(
			path.join(drizzleRoot, `meta/${String(migration.idx).padStart(4, "0")}_snapshot.json`),
			snapshot,
		);
	};
	const initialEntries = [entry(0), entry(1)];
	await writeJournal(initialEntries);
	for (const migration of initialEntries) {
		await writeMigration(migration);
	}
	git(repositoryRoot, "add", ".");
	git(repositoryRoot, "commit", "--quiet", "-m", "base");
	const base = git(repositoryRoot, "rev-parse", "HEAD");
	return {
		base,
		commit: async (message: string) => {
			git(repositoryRoot, "add", "-A");
			git(repositoryRoot, "commit", "--quiet", "-m", message);
			return git(repositoryRoot, "rev-parse", "HEAD");
		},
		repositoryRoot,
		writeJournal,
		writeMigration,
	};
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
	const fixture = await createFixture();
	try {
		await run(fixture);
	} finally {
		await rm(fixture.repositoryRoot, { force: true, recursive: true });
	}
}

test("accepts suffix-only app-api migration additions", async () => {
	await withFixture(async (fixture) => {
		const added = entry(2);
		await fixture.writeMigration(added);
		await fixture.writeJournal([entry(0), entry(1), added]);
		const head = await fixture.commit("append migration");
		assert.doesNotThrow(() => {
			execFileSync(
				process.execPath,
				[
					"--experimental-strip-types",
					SCRIPT_PATH,
					"--base",
					fixture.base,
					"--head",
					head,
					"--root",
					fixture.repositoryRoot,
				],
				{ encoding: "utf8" },
			);
		});
	});
});

test("ignores changes outside app-api drizzle history", async () => {
	await withFixture(async (fixture) => {
		await writeFile(path.join(fixture.repositoryRoot, "README.md"), "unchanged migrations\n");
		const head = await fixture.commit("docs");
		assert.doesNotThrow(() =>
			checkAppApiMigrationHistory({
				base: fixture.base,
				head,
				repositoryRoot: fixture.repositoryRoot,
			}),
		);
	});
});

test("rejects changes to an existing migration journal entry", async () => {
	await withFixture(async (fixture) => {
		const changed = { ...entry(1), when: 2_000 };
		await fixture.writeJournal([entry(0), changed]);
		const head = await fixture.commit("rewrite journal");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/journal entry changed after publication/u,
		);
	});
});

test("rejects deletion of an existing migration", async () => {
	await withFixture(async (fixture) => {
		await fixture.writeJournal([entry(0)]);
		await rm(path.join(fixture.repositoryRoot, "apps/app-api/drizzle/0001_migration_1.sql"));
		await rm(path.join(fixture.repositoryRoot, "apps/app-api/drizzle/meta/0001_snapshot.json"));
		const head = await fixture.commit("delete migration");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/journal entries were deleted/u,
		);
	});
});

test("rejects a new migration that reuses an earlier timestamp", async () => {
	await withFixture(async (fixture) => {
		const added = { ...entry(2), when: entry(1).when };
		await fixture.writeMigration(added);
		await fixture.writeJournal([entry(0), entry(1), added]);
		const head = await fixture.commit("reuse timestamp");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/migration timestamps are not append-only/u,
		);
	});
});

test("rejects changes to existing migration SQL", async () => {
	await withFixture(async (fixture) => {
		await fixture.writeMigration(entry(1), "select 'rewritten';\n");
		const head = await fixture.commit("rewrite sql");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/migration SQL changed after publication/u,
		);
	});
});

test("rejects changes to existing migration snapshots", async () => {
	await withFixture(async (fixture) => {
		await fixture.writeMigration(entry(1), undefined, '{"rewritten":true}\n');
		const head = await fixture.commit("rewrite snapshot");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/migration snapshot changed after publication/u,
		);
	});
});

test("rejects migration files outside the journal suffix", async () => {
	await withFixture(async (fixture) => {
		await writeFile(
			path.join(fixture.repositoryRoot, "apps/app-api/drizzle/0002_untracked.sql"),
			"select 2;\n",
		);
		const head = await fixture.commit("add untracked migration");
		assert.throws(
			() =>
				checkAppApiMigrationHistory({
					base: fixture.base,
					head,
					repositoryRoot: fixture.repositoryRoot,
				}),
			/SQL files do not match the journal/u,
		);
	});
});
