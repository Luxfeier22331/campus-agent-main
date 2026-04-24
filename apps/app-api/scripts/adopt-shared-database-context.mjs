import fs from "node:fs";
import { join } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";

import {
	drizzleRoot,
	metaRoot,
	normalizeColumnSpec,
	normalizeSnapshotIndexSpec,
} from "./adopt-shared-database-shared.mjs";

export function loadMigrationJournal() {
	return JSON.parse(fs.readFileSync(join(metaRoot, "_journal.json"), "utf8"));
}

function resolveSnapshotPath(entryOrTag) {
	const candidates = [];
	if (typeof entryOrTag === "string") {
		candidates.push(join(metaRoot, `${entryOrTag}_snapshot.json`));
		const prefixedMatch = entryOrTag.match(/^(\d{4})_/);
		if (prefixedMatch) {
			candidates.push(join(metaRoot, `${prefixedMatch[1]}_snapshot.json`));
		}
	} else {
		candidates.push(join(metaRoot, `${entryOrTag.tag}_snapshot.json`));
		if (typeof entryOrTag.idx === "number") {
			candidates.push(join(metaRoot, `${String(entryOrTag.idx).padStart(4, "0")}_snapshot.json`));
		}
		const prefixedMatch = entryOrTag.tag?.match?.(/^(\d{4})_/);
		if (prefixedMatch) {
			candidates.push(join(metaRoot, `${prefixedMatch[1]}_snapshot.json`));
		}
	}

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		`Drizzle snapshot file not found for ${typeof entryOrTag === "string" ? entryOrTag : entryOrTag.tag}`,
	);
}

export function loadSnapshot(entryOrTag) {
	return JSON.parse(fs.readFileSync(resolveSnapshotPath(entryOrTag), "utf8"));
}

function splitMigrationStatements(statement) {
	return statement
		.trim()
		.split(/;\s*(?=(?:ALTER|CREATE|DROP)\b|$)/i)
		.map((item) => item.trim())
		.filter(Boolean)
		.map((item) => (item.endsWith(";") ? item : `${item};`));
}

export function loadMigrationContext() {
	const journal = loadMigrationJournal();
	const migrationFiles = readMigrationFiles({ migrationsFolder: drizzleRoot });
	if (migrationFiles.length !== journal.entries.length) {
		throw new Error(
			`app-api drizzle meta mismatch: journal has ${journal.entries.length} entries but drizzle folder has ${migrationFiles.length} migrations`,
		);
	}
	const migrations = migrationFiles.map((migration, index) => ({
		...migration,
		statements: migration.sql.flatMap(splitMigrationStatements),
		tag: journal.entries[index].tag,
	}));
	const snapshots = new Map(journal.entries.map((entry) => [entry.tag, loadSnapshot(entry)]));
	const latestTag = journal.entries.at(-1)?.tag;
	if (!latestTag) {
		throw new Error("app-api drizzle meta journal is empty");
	}
	const latestSnapshot = snapshots.get(latestTag);
	if (!latestSnapshot) {
		throw new Error(`Latest drizzle snapshot not found for ${latestTag}`);
	}
	return {
		journal,
		latestTag,
		latestSnapshot,
		migrations,
		snapshots,
	};
}

export function buildExpectedTableSpecs(snapshot) {
	const specs = new Map();
	for (const [qualifiedName, tableSpec] of Object.entries(snapshot.tables ?? {})) {
		const columns = new Map(
			Object.entries(tableSpec.columns ?? {}).map(([columnName, columnSpec]) => [
				columnName,
				normalizeColumnSpec(columnSpec),
			]),
		);
		for (const compositePrimaryKey of Object.values(tableSpec.compositePrimaryKeys ?? {})) {
			for (const columnName of compositePrimaryKey.columns ?? []) {
				const existingColumn = columns.get(columnName);
				if (existingColumn) {
					existingColumn.primaryKey = true;
				}
			}
		}
		specs.set(qualifiedName, {
			columns,
			constraints: new Set(Object.keys(tableSpec.foreignKeys ?? {})),
			indexes: new Map(
				Object.entries(tableSpec.indexes ?? {}).map(([indexName, indexSpec]) => [
					indexName,
					normalizeSnapshotIndexSpec(indexName, indexSpec),
				]),
			),
			schema: tableSpec.schema,
			table: tableSpec.name,
		});
	}
	return specs;
}
