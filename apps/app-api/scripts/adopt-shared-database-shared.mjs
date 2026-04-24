import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_API_MIGRATIONS_SCHEMA = "drizzle";
export const APP_API_MIGRATIONS_TABLE = "app_api_migrations";
export const APP_API_KNOWN_SCHEMAS = ["runtime", "operator", "official_web"];

export const CREATE_SCHEMA_RE = /^CREATE SCHEMA IF NOT EXISTS "([^"]+)";?$/i;
export const CREATE_TABLE_RE = /^CREATE TABLE "([^"]+)"\."([^"]+)" \(/i;
export const ALTER_TABLE_ADD_COLUMN_RE =
	/^ALTER TABLE "([^"]+)"\."([^"]+)"\s+ADD\s+COLUMN "([^"]+)"/i;
export const ALTER_TABLE_DROP_COLUMN_RE =
	/^ALTER TABLE "([^"]+)"\."([^"]+)"\s+DROP\s+COLUMN(?: IF EXISTS)? "([^"]+)"/i;
export const ALTER_TABLE_CONSTRAINT_RE =
	/^ALTER TABLE "([^"]+)"\."([^"]+)"\s+ADD\s+CONSTRAINT "([^"]+)"/i;
export const CREATE_INDEX_RE = /^CREATE (?:UNIQUE )?INDEX "([^"]+)"\s+ON\s+"([^"]+)"\."([^"]+)"/i;
export const DROP_INDEX_RE = /^DROP INDEX "([^"]+)"\."([^"]+)";?$/i;

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptsDir);
export const drizzleRoot = join(appRoot, "drizzle");
export const metaRoot = join(drizzleRoot, "meta");

export function quoteIdentifier(identifier) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

export function qualifyTable(schema, table) {
	return `${schema}.${table}`;
}

export function normalizeColumnSpec(columnSpec) {
	return {
		name: columnSpec.name,
		notNull: Boolean(columnSpec.notNull),
		primaryKey: Boolean(columnSpec.primaryKey),
		type: columnSpec.type,
	};
}

export function normalizeSnapshotIndexSpec(indexName, indexSpec) {
	return {
		columns: (indexSpec.columns ?? []).map((column) => column.expression),
		method: typeof indexSpec.method === "string" ? indexSpec.method.toLowerCase() : null,
		name: indexName,
		unique: Boolean(indexSpec.isUnique),
	};
}

export function normalizeInventoryIndexSpec(indexSpec) {
	if (typeof indexSpec === "string") {
		return {
			columns: [],
			method: null,
			name: indexSpec,
			unique: null,
		};
	}

	return {
		columns: [...(indexSpec.columns ?? [])],
		method: typeof indexSpec.method === "string" ? indexSpec.method.toLowerCase() : null,
		name: indexSpec.name,
		unique: typeof indexSpec.unique === "boolean" ? indexSpec.unique : null,
	};
}

export function parseIndexDefinition(indexName, indexDefinition) {
	const match = indexDefinition.match(/^CREATE (UNIQUE )?INDEX .* USING (\w+) \((.*)\)$/i);
	if (!match) {
		return normalizeInventoryIndexSpec(indexName);
	}

	return {
		columns: match[3].split(",").map((column) => column.trim().replaceAll('"', "")),
		method: match[2].toLowerCase(),
		name: indexName,
		unique: Boolean(match[1]),
	};
}

export function compareIndexSpec(actual, expected) {
	return (
		actual.method === expected.method &&
		actual.unique === expected.unique &&
		actual.columns.length === expected.columns.length &&
		actual.columns.every((column, index) => column === expected.columns[index])
	);
}

export function hasPlannedTarget(plannedTargetKeys, expectedKey, qualifiedName) {
	return plannedTargetKeys.has(expectedKey) || plannedTargetKeys.has(qualifiedName);
}
