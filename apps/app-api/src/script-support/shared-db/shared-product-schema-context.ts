import fs from "node:fs";
import { join } from "node:path";
import type {
	DrizzleSnapshot,
	MigrationJournal,
	MigrationJournalEntry,
	TableSpec,
	TableSpecMap,
} from "./shared-db-script-types.ts";
import {
	metaRoot,
	normalizeColumnSpec,
	normalizeSnapshotIndexSpec,
} from "./shared-product-schema-shared.ts";

export function loadMigrationJournal(): MigrationJournal {
	return JSON.parse(fs.readFileSync(join(metaRoot, "_journal.json"), "utf8")) as MigrationJournal;
}

function resolveSnapshotPath(entryOrTag: MigrationJournalEntry | string): string {
	const candidates: string[] = [];
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

export function loadSnapshot(entryOrTag: MigrationJournalEntry | string): DrizzleSnapshot {
	return JSON.parse(fs.readFileSync(resolveSnapshotPath(entryOrTag), "utf8")) as DrizzleSnapshot;
}

export function splitCurrentSchemaStatements(sql: string): string[] {
	const statements: string[] = [];
	let statementStart = 0;
	let singleQuote = false;
	let dollarQuote: string | null = null;

	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index];
		if (dollarQuote) {
			if (sql.startsWith(dollarQuote, index)) {
				index += dollarQuote.length - 1;
				dollarQuote = null;
			}
			continue;
		}
		if (singleQuote) {
			if (character === "'" && sql[index + 1] === "'") {
				index += 1;
			} else if (character === "'") {
				singleQuote = false;
			}
			continue;
		}
		if (character === "'") {
			singleQuote = true;
			continue;
		}
		if (character === "$") {
			const tag = sql.slice(index).match(/^\$[A-Za-z_0-9]*\$/u)?.[0];
			if (tag) {
				dollarQuote = tag;
				index += tag.length - 1;
				continue;
			}
		}
		if (character === ";") {
			const statement = sql.slice(statementStart, index + 1).trim();
			if (statement) {
				statements.push(statement);
			}
			statementStart = index + 1;
		}
	}

	const trailing = sql.slice(statementStart).trim();
	if (trailing) {
		statements.push(`${trailing};`);
	}
	return statements;
}

export function loadCurrentDrizzleSnapshot(): DrizzleSnapshot {
	const journal = loadMigrationJournal();
	const latestEntry = journal.entries.at(-1);
	if (!latestEntry) {
		throw new Error("app-api drizzle meta journal is empty");
	}
	return loadSnapshot(latestEntry);
}

export function buildExpectedTableSpecs(snapshot: DrizzleSnapshot): TableSpecMap {
	const specs: TableSpecMap = new Map();
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
		} satisfies TableSpec);
	}
	return specs;
}
