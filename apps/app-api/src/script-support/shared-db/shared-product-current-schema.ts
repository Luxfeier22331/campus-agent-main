import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	DrizzleSnapshot,
	NormalizedColumnSpec,
	TableSpec,
	TableSpecMap,
} from "./shared-db-script-types.ts";
import {
	buildExpectedTableSpecs,
	splitCurrentSchemaStatements,
} from "./shared-product-schema-context.ts";
import { APP_API_KNOWN_SCHEMAS } from "./shared-product-schema-shared.ts";

const sharedProductSchemaRoot = fileURLToPath(
	new URL("../../../db/shared-product-schema/", import.meta.url),
);

function cloneTableSpec(tableSpec: TableSpec): TableSpec {
	return {
		columns: new Map(
			[...tableSpec.columns.entries()].map(([columnName, column]) => [columnName, { ...column }]),
		),
		constraints: new Set(tableSpec.constraints),
		indexes: new Map(
			[...tableSpec.indexes.entries()].map(([indexName, index]) => [
				indexName,
				{
					...index,
					columns: [...index.columns],
				},
			]),
		),
		schema: tableSpec.schema,
		table: tableSpec.table,
	};
}

function normalizeColumnDefinitionType(definition: string): string {
	const withoutDefault = definition.split(/\s+DEFAULT\s+/i)[0] ?? definition;
	const type = withoutDefault
		.replace(/\s+PRIMARY\s+KEY\b/gi, "")
		.replace(/\s+NOT\s+NULL\b/gi, "")
		.replace(/\s+NULL\b/gi, "")
		.replace(/\s+REFERENCES\b[\s\S]+$/i, "")
		.trim()
		.toLowerCase();
	return type === "timestamptz" ? "timestamp with time zone" : type;
}

function parseSharedProductColumnDefinition(definition: string): NormalizedColumnSpec {
	const match = definition.trim().match(/^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+([\s\S]+)$/iu);
	if (!match) {
		throw new Error(`Unsupported shared-product column definition: ${definition.trim()}`);
	}
	const rawDefinition = match[3].replace(/[,;]$/u, "").trim();
	return {
		defaultValue: null,
		name: match[1] ?? match[2],
		notNull: /\bNOT\s+NULL\b/i.test(rawDefinition),
		primaryKey: /\bPRIMARY\s+KEY\b/i.test(rawDefinition),
		type: normalizeColumnDefinitionType(rawDefinition),
	};
}

function listSharedProductSchemaFiles(): string[] {
	return readdirSync(sharedProductSchemaRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => join(sharedProductSchemaRoot, entry.name))
		.sort();
}

function splitTopLevelSqlList(input: string): string[] {
	return input
		.split(/,\s*\n/u)
		.map((item) => item.trim())
		.filter(Boolean);
}

function ensureCurrentSharedProductTableSpec(
	specs: TableSpecMap,
	schema: string,
	table: string,
): TableSpec {
	const qualifiedName = `${schema}.${table}`;
	let tableSpec = specs.get(qualifiedName);
	if (!tableSpec) {
		tableSpec = {
			columns: new Map(),
			constraints: new Set(),
			indexes: new Map(),
			schema,
			table,
		};
		specs.set(qualifiedName, tableSpec);
	}
	return tableSpec;
}

function applySharedProductCreateTableStatement(specs: TableSpecMap, statement: string): boolean {
	const match = statement.match(
		/^CREATE TABLE IF NOT EXISTS "([^"]+)"\."([^"]+)"\s+\(([\s\S]+)\);?$/i,
	);
	if (!match) {
		return false;
	}

	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[1], match[2]);
	for (const definition of splitTopLevelSqlList(match[3])) {
		const primaryKeyMatch = definition.match(/^PRIMARY\s+KEY\s+\(([\s\S]+)\)$/i);
		if (primaryKeyMatch) {
			for (const columnName of primaryKeyMatch[1]
				.split(",")
				.map((column) => column.trim().replace(/^"|"$/gu, ""))) {
				const column = tableSpec.columns.get(columnName);
				if (!column) {
					throw new Error(
						`Shared-product primary key references unknown column ${match[1]}.${match[2]}.${columnName}`,
					);
				}
				column.primaryKey = true;
				column.notNull = true;
			}
			continue;
		}
		const column = parseSharedProductColumnDefinition(definition);
		tableSpec.columns.set(column.name, column);
	}
	return true;
}

function applySharedProductCreateIndexStatement(specs: TableSpecMap, statement: string): boolean {
	const match = statement.match(
		/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)? (?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+"([^"]+)"\."([^"]+)"(?:\s+USING\s+(\w+))?\s+\(([\s\S]+)\);?$/i,
	);
	if (!match) {
		return false;
	}

	const indexName = match[2] ?? match[3];
	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[4], match[5]);
	tableSpec.indexes.set(indexName, {
		columns: match[7].split(",").map((column: string) =>
			column
				.trim()
				.replace(/\s+(ASC|DESC)\b/iu, "")
				.replace(/^"|"$/gu, ""),
		),
		method: (match[6] ?? "btree").toLowerCase(),
		name: indexName,
		unique: Boolean(match[1]),
	});
	return true;
}

function applySharedProductSchemaStatement(specs: TableSpecMap, statement: string): void {
	const trimmed = statement.trim();
	if (
		applySharedProductCreateTableStatement(specs, trimmed) ||
		applySharedProductCreateIndexStatement(specs, trimmed)
	) {
		return;
	}
	if (/^CREATE SCHEMA(?: IF NOT EXISTS)? "[a-z_][a-z0-9_]*";?$/i.test(trimmed)) {
		return;
	}
	if (
		/^ALTER TABLE "chat"\."turn_dispatches"\s+(?:ADD COLUMN IF NOT EXISTS|ALTER COLUMN)\s+/iu.test(
			trimmed,
		) ||
		/^UPDATE "chat"\."turn_dispatches"\s+SET /iu.test(trimmed)
	) {
		return;
	}
	throw new Error(`Unsupported shared-product schema baseline statement shape: ${trimmed}`);
}

export function validateSharedProductCurrentSchemaSql(source: string): void {
	const specs: TableSpecMap = new Map();
	for (const statement of splitCurrentSchemaStatements(source)) {
		applySharedProductSchemaStatement(specs, statement);
	}
}

function buildSharedProductSchemaTableSpecs(): TableSpecMap {
	const specs: TableSpecMap = new Map();
	for (const schemaFile of listSharedProductSchemaFiles()) {
		const source = readFileSync(schemaFile, "utf8");
		for (const statement of splitCurrentSchemaStatements(source)) {
			applySharedProductSchemaStatement(specs, statement);
		}
	}
	return specs;
}

export function buildCurrentSharedDatabaseExpectedTableSpecs(
	snapshot: DrizzleSnapshot,
): TableSpecMap {
	const specs = buildExpectedTableSpecs(snapshot);
	for (const [qualifiedName, tableSpec] of buildSharedProductSchemaTableSpecs()) {
		if (specs.has(qualifiedName) || !APP_API_KNOWN_SCHEMAS.includes(tableSpec.schema)) {
			continue;
		}
		specs.set(qualifiedName, cloneTableSpec(tableSpec));
	}
	return new Map(
		[...specs.entries()].map(([qualifiedName, tableSpec]) => [
			qualifiedName,
			cloneTableSpec(tableSpec),
		]),
	);
}
