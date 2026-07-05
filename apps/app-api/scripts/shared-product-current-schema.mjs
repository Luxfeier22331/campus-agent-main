import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_API_KNOWN_SCHEMAS, buildExpectedTableSpecs } from "./adopt-shared-database.mjs";
import { splitMigrationStatements } from "./adopt-shared-database-context.mjs";

const sharedProductMigrationsRoot = fileURLToPath(
	new URL("../db/shared-product-migrations/", import.meta.url),
);

function cloneTableSpec(tableSpec) {
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

function normalizeColumnDefinitionType(definition) {
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

function parseSharedProductColumnDefinition(definition) {
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

function listSharedProductMigrationFiles() {
	return readdirSync(sharedProductMigrationsRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => join(sharedProductMigrationsRoot, entry.name))
		.sort();
}

function splitTopLevelSqlList(input) {
	return input
		.split(/,\s*\n/u)
		.map((item) => item.trim())
		.filter(Boolean);
}

function ensureCurrentSharedProductTableSpec(specs, schema, table) {
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

function applySharedProductCreateTableStatement(specs, statement) {
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

function applySharedProductAddColumnStatement(specs, statement) {
	const match = statement.match(
		/^ALTER TABLE "([^"]+)"\."([^"]+)"\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([\s\S]+);?$/i,
	);
	if (!match) {
		return false;
	}

	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[1], match[2]);
	const column = parseSharedProductColumnDefinition(match[3]);
	tableSpec.columns.set(column.name, column);
	return true;
}

function applySharedProductColumnMutationStatement(specs, statement) {
	const match = statement.match(
		/^ALTER TABLE "([^"]+)"\."([^"]+)"\s+ALTER\s+COLUMN (?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+(DROP\s+DEFAULT|SET\s+NOT\s+NULL|DROP\s+NOT\s+NULL);?$/i,
	);
	if (!match) {
		return false;
	}

	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[1], match[2]);
	const columnName = match[3] ?? match[4];
	const column = tableSpec.columns.get(columnName);
	if (!column) {
		throw new Error(
			`Shared-product migration mutates unknown column ${match[1]}.${match[2]}.${columnName}`,
		);
	}
	const operation = match[5].toUpperCase();
	if (operation === "DROP DEFAULT") {
		column.defaultValue = null;
	} else if (operation === "SET NOT NULL") {
		column.notNull = true;
	} else if (operation === "DROP NOT NULL") {
		column.notNull = false;
	}
	return true;
}

function applySharedProductCreateIndexStatement(specs, statement) {
	const match = statement.match(
		/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)? (?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+"([^"]+)"\."([^"]+)"(?:\s+USING\s+(\w+))?\s+\(([\s\S]+)\);?$/i,
	);
	if (!match) {
		return false;
	}

	const indexName = match[2] ?? match[3];
	const tableSpec = ensureCurrentSharedProductTableSpec(specs, match[4], match[5]);
	tableSpec.indexes.set(indexName, {
		columns: match[7].split(",").map((column) =>
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

function applySharedProductMigrationStatement(specs, statement) {
	const trimmed = statement.trim();
	if (
		applySharedProductCreateTableStatement(specs, trimmed) ||
		applySharedProductAddColumnStatement(specs, trimmed) ||
		applySharedProductColumnMutationStatement(specs, trimmed) ||
		applySharedProductCreateIndexStatement(specs, trimmed)
	) {
		return;
	}
	if (/^(CREATE SCHEMA|DELETE FROM|UPDATE)\b/i.test(trimmed)) {
		return;
	}
	throw new Error(`Unsupported shared-product migration statement shape: ${trimmed}`);
}

function buildSharedProductMigrationTableSpecs() {
	const specs = new Map();
	for (const migrationFile of listSharedProductMigrationFiles()) {
		const source = readFileSync(migrationFile, "utf8");
		for (const statement of splitMigrationStatements(source)) {
			applySharedProductMigrationStatement(specs, statement);
		}
	}
	return specs;
}

export function buildCurrentSharedDatabaseExpectedTableSpecs(snapshot) {
	const specs = buildExpectedTableSpecs(snapshot);
	for (const [qualifiedName, tableSpec] of buildSharedProductMigrationTableSpecs()) {
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
