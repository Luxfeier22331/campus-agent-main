import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const DRIZZLE_ROOT = "apps/app-api/drizzle";
const JOURNAL_PATH = `${DRIZZLE_ROOT}/meta/_journal.json`;

interface MigrationEntry {
	breakpoints: boolean;
	idx: number;
	tag: string;
	version: string;
	when: number;
}

interface MigrationJournal {
	dialect: string;
	entries: MigrationEntry[];
	version: string;
}

interface MigrationState {
	journal: MigrationJournal;
	migrationBlobs: Map<string, string>;
	snapshotBlobs: Map<string, string>;
}

function git(repositoryRoot: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
	}
	return result.stdout;
}

function changedDrizzleHistory(repositoryRoot: string, base: string, head: string): boolean {
	const result = spawnSync("git", ["diff", "--quiet", base, head, "--", DRIZZLE_ROOT], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status === 0) {
		return false;
	}
	if (result.status === 1) {
		return true;
	}
	throw new Error(result.stderr.trim() || "git diff failed");
}

function lines(source: string): string[] {
	return source
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.sort((left, right) => left.localeCompare(right));
}

function parseJournal(source: string, revision: string): MigrationJournal {
	const value = JSON.parse(source) as Partial<MigrationJournal>;
	if (
		typeof value.version !== "string" ||
		typeof value.dialect !== "string" ||
		!Array.isArray(value.entries)
	) {
		throw new Error(`invalid app-api migration journal at ${revision}`);
	}
	return value as MigrationJournal;
}

function assertJournalShape(journal: MigrationJournal, revision: string): void {
	for (const [position, entry] of journal.entries.entries()) {
		const sequence = String(position).padStart(4, "0");
		if (entry.idx !== position || !entry.tag.startsWith(`${sequence}_`)) {
			throw new Error(`app-api migration sequence is invalid at ${revision}: ${entry.tag}`);
		}
		const previous = journal.entries[position - 1];
		if (previous && entry.when <= previous.when) {
			throw new Error(
				`app-api migration timestamps are not append-only at ${revision}: ${entry.tag}`,
			);
		}
	}
}

function readState(repositoryRoot: string, revision: string): MigrationState {
	const journal = parseJournal(
		git(repositoryRoot, ["show", `${revision}:${JOURNAL_PATH}`]),
		revision,
	);
	assertJournalShape(journal, revision);
	const migrationFiles = lines(
		git(repositoryRoot, ["ls-tree", "--name-only", `${revision}:${DRIZZLE_ROOT}`]),
	).filter((file) => /^\d{4}_.+\.sql$/u.test(file));
	const snapshotFiles = lines(
		git(repositoryRoot, ["ls-tree", "--name-only", `${revision}:${DRIZZLE_ROOT}/meta`]),
	).filter((file) => /^\d{4}_snapshot\.json$/u.test(file));
	const expectedMigrations = journal.entries.map((entry) => `${entry.tag}.sql`).sort();
	const expectedSnapshots = journal.entries.map(
		(entry) => `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
	);
	if (!isDeepStrictEqual(migrationFiles, expectedMigrations)) {
		throw new Error(`app-api migration SQL files do not match the journal at ${revision}`);
	}
	if (!isDeepStrictEqual(snapshotFiles, expectedSnapshots)) {
		throw new Error(`app-api migration snapshots do not match the journal at ${revision}`);
	}
	return {
		journal,
		migrationBlobs: new Map(
			journal.entries.map((entry) => {
				const file = `${entry.tag}.sql`;
				return [
					file,
					git(repositoryRoot, ["rev-parse", `${revision}:${DRIZZLE_ROOT}/${file}`]).trim(),
				];
			}),
		),
		snapshotBlobs: new Map(
			journal.entries.map((entry) => {
				const file = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
				return [
					file,
					git(repositoryRoot, ["rev-parse", `${revision}:${DRIZZLE_ROOT}/meta/${file}`]).trim(),
				];
			}),
		),
	};
}

export function checkAppApiMigrationHistory(input: {
	base: string;
	head: string;
	repositoryRoot: string;
}): void {
	if (!changedDrizzleHistory(input.repositoryRoot, input.base, input.head)) {
		return;
	}
	const base = readState(input.repositoryRoot, input.base);
	const head = readState(input.repositoryRoot, input.head);
	if (
		base.journal.version !== head.journal.version ||
		base.journal.dialect !== head.journal.dialect
	) {
		throw new Error("app-api migration journal metadata changed");
	}
	if (head.journal.entries.length < base.journal.entries.length) {
		throw new Error("app-api migration journal entries were deleted");
	}
	for (const [position, baseEntry] of base.journal.entries.entries()) {
		if (!isDeepStrictEqual(head.journal.entries[position], baseEntry)) {
			throw new Error(
				`app-api migration journal entry changed after publication: ${baseEntry.tag}`,
			);
		}
		const sqlFile = `${baseEntry.tag}.sql`;
		if (base.migrationBlobs.get(sqlFile) !== head.migrationBlobs.get(sqlFile)) {
			throw new Error(`app-api migration SQL changed after publication: ${sqlFile}`);
		}
		const snapshotFile = `${String(baseEntry.idx).padStart(4, "0")}_snapshot.json`;
		if (base.snapshotBlobs.get(snapshotFile) !== head.snapshotBlobs.get(snapshotFile)) {
			throw new Error(`app-api migration snapshot changed after publication: ${snapshotFile}`);
		}
	}
}

function argumentsMap(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		const value = args[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error("Expected paired --name value arguments");
		}
		values.set(key.slice(2), value);
	}
	return values;
}

function required(values: Map<string, string>, name: string): string {
	const value = values.get(name);
	if (!value) {
		throw new Error(`Missing --${name}`);
	}
	return value;
}

function main(args: string[]): void {
	const values = argumentsMap(args);
	checkAppApiMigrationHistory({
		base: required(values, "base"),
		head: required(values, "head"),
		repositoryRoot: path.resolve(values.get("root") ?? process.cwd()),
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
