import pg from "pg";

import {
	APP_API_KNOWN_SCHEMAS,
	compareIndexSpec,
	hasPlannedTarget,
	normalizeInventoryIndexSpec,
	normalizePostgresIdentifier,
	parseIndexDefinition,
	qualifyTable,
} from "./adopt-shared-database-shared.mjs";

function buildEmptyInventory() {
	return {
		journalRows: [],
		schemas: new Set(),
		tables: new Map(),
	};
}

export function cloneInventory(inventory) {
	return {
		journalRows: [...inventory.journalRows],
		schemas: new Set(inventory.schemas),
		tables: new Map(
			[...inventory.tables.entries()].map(([qualifiedName, table]) => [
				qualifiedName,
				{
					columns: new Map(
						[...table.columns.entries()].map(([columnName, column]) => [columnName, { ...column }]),
					),
					constraints: new Set(table.constraints),
					indexes: new Map(
						[...table.indexes.entries()].map(([indexName, indexSpec]) => [
							indexName,
							{
								...indexSpec,
								columns: [...indexSpec.columns],
							},
						]),
					),
					schema: table.schema,
					table: table.table,
				},
			]),
		),
	};
}

export function makeInventory(input = {}) {
	const inventory = buildEmptyInventory();
	for (const schema of input.schemas ?? []) {
		inventory.schemas.add(schema);
	}
	for (const table of input.tables ?? []) {
		inventory.tables.set(qualifyTable(table.schema, table.table), {
			columns: new Map(
				(table.columns ?? []).map((column) => [
					column.name,
					{
						defaultValue: "defaultValue" in column ? column.defaultValue : null,
						name: column.name,
						notNull: Boolean(column.notNull),
						primaryKey: Boolean(column.primaryKey),
						type: column.type,
					},
				]),
			),
			constraints: new Set(table.constraints ?? []),
			indexes: new Map(
				(table.indexes ?? []).map((indexSpec) => {
					const normalizedIndex = normalizeInventoryIndexSpec(indexSpec);
					return [normalizedIndex.name, normalizedIndex];
				}),
			),
			schema: table.schema,
			table: table.table,
		});
		inventory.schemas.add(table.schema);
	}
	inventory.journalRows = [...(input.journalRows ?? [])];
	return inventory;
}

function summarizeKnownTables(inventory, expectedTables) {
	return [...inventory.tables.keys()].filter((qualifiedName) => expectedTables.has(qualifiedName));
}

export function classifySharedDatabaseState({ inventory, snapshot0000, snapshotLatest }) {
	const expected0000 = new Map(Object.entries(snapshot0000.tables ?? {}));
	const expectedLatest = new Map(Object.entries(snapshotLatest.tables ?? {}));
	if (inventory.journalRows.length > 0) {
		return "journal_managed";
	}
	const knownTables = summarizeKnownTables(inventory, expectedLatest);
	if (knownTables.length === 0) {
		return "fresh";
	}
	const hasAll0000 = [...expected0000.keys()].every((qualifiedName) =>
		inventory.tables.has(qualifiedName),
	);
	const hasAllLatest = [...expectedLatest.keys()].every((qualifiedName) =>
		inventory.tables.has(qualifiedName),
	);
	if (hasAllLatest) {
		return "full_latest_without_journal";
	}
	if (hasAll0000) {
		return "full_0000_without_journal";
	}
	return "partial_without_journal";
}

function compareColumnSpec(actual, expected) {
	return (
		actual.type === expected.type &&
		actual.notNull === expected.notNull &&
		actual.primaryKey === expected.primaryKey
	);
}

export function validateInventoryAgainstExpectedTables(
	inventory,
	expectedTables,
	plannedTargetKeys = new Set(),
) {
	const mismatches = [];
	for (const [qualifiedName, actualTable] of inventory.tables.entries()) {
		const expectedTable = expectedTables.get(qualifiedName);
		if (!expectedTable) {
			continue;
		}
		const actualColumns = actualTable.columns;
		const expectedColumns = expectedTable.columns;
		for (const [columnName, expectedColumn] of expectedColumns.entries()) {
			const actualColumn = actualColumns.get(columnName);
			if (!actualColumn) {
				if (!hasPlannedTarget(plannedTargetKeys, `${qualifiedName}:${columnName}`, qualifiedName)) {
					mismatches.push(`${qualifiedName} missing column ${columnName}`);
				}
				continue;
			}
			if (!compareColumnSpec(actualColumn, expectedColumn)) {
				mismatches.push(
					`${qualifiedName}.${columnName} mismatch: expected ${expectedColumn.type}/${expectedColumn.notNull}/${expectedColumn.primaryKey}, got ${actualColumn.type}/${actualColumn.notNull}/${actualColumn.primaryKey}`,
				);
			}
		}
		for (const columnName of actualColumns.keys()) {
			if (
				!(
					expectedColumns.has(columnName) ||
					hasPlannedTarget(plannedTargetKeys, `${qualifiedName}:${columnName}`, qualifiedName)
				)
			) {
				mismatches.push(`${qualifiedName} unexpected column ${columnName}`);
			}
		}
		for (const constraint of expectedTable.constraints) {
			const normalizedConstraint = normalizePostgresIdentifier(constraint);
			if (
				!(
					actualTable.constraints.has(constraint) ||
					actualTable.constraints.has(normalizedConstraint) ||
					hasPlannedTarget(plannedTargetKeys, `${qualifiedName}#${constraint}`, qualifiedName)
				)
			) {
				mismatches.push(`${qualifiedName} missing constraint ${constraint}`);
			}
		}
		for (const [indexName, expectedIndex] of expectedTable.indexes.entries()) {
			const actualIndex =
				actualTable.indexes.get(indexName) ??
				actualTable.indexes.get(normalizePostgresIdentifier(indexName));
			if (!actualIndex) {
				if (!hasPlannedTarget(plannedTargetKeys, `${qualifiedName}@${indexName}`, qualifiedName)) {
					mismatches.push(`${qualifiedName} missing index ${indexName}`);
				}
				continue;
			}
			if (!compareIndexSpec(actualIndex, expectedIndex)) {
				mismatches.push(`${qualifiedName} index ${indexName} definition mismatch`);
			}
		}
	}
	return mismatches;
}

export async function readDatabaseInventory(client) {
	const inventory = buildEmptyInventory();
	const { rows: schemaRows } = await client.query(
		"select schema_name from information_schema.schemata where schema_name = any($1::text[]) order by schema_name asc",
		[APP_API_KNOWN_SCHEMAS],
	);
	for (const row of schemaRows) {
		inventory.schemas.add(row.schema_name);
	}
	const { rows: tableRows } = await client.query(
		"select table_schema, table_name from information_schema.tables where table_schema = any($1::text[]) and table_type = 'BASE TABLE'",
		[APP_API_KNOWN_SCHEMAS],
	);
	const { rows: columnRows } = await client.query(
		"select table_schema, table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = any($1::text[])",
		[APP_API_KNOWN_SCHEMAS],
	);
	const { rows: indexRows } = await client.query(
		"select schemaname as table_schema, tablename as table_name, indexname, indexdef from pg_indexes where schemaname = any($1::text[])",
		[APP_API_KNOWN_SCHEMAS],
	);
	const { rows: constraintRows } = await client.query(
		`select n.nspname as table_schema, c.relname as table_name, con.conname as constraint_name
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any($1::text[])`,
		[APP_API_KNOWN_SCHEMAS],
	);

	for (const tableRow of tableRows) {
		inventory.tables.set(qualifyTable(tableRow.table_schema, tableRow.table_name), {
			columns: new Map(),
			constraints: new Set(),
			indexes: new Map(),
			schema: tableRow.table_schema,
			table: tableRow.table_name,
		});
	}
	for (const columnRow of columnRows) {
		const table = inventory.tables.get(qualifyTable(columnRow.table_schema, columnRow.table_name));
		if (!table) {
			continue;
		}
		table.columns.set(columnRow.column_name, {
			defaultValue: columnRow.column_default ?? null,
			name: columnRow.column_name,
			notNull: columnRow.is_nullable === "NO",
			primaryKey: false,
			type: columnRow.data_type,
		});
	}
	const { rows: primaryKeyRows } = await client.query(
		`select tc.table_schema, tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name
        and tc.table_schema = kcu.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = any($1::text[])`,
		[APP_API_KNOWN_SCHEMAS],
	);
	for (const row of primaryKeyRows) {
		const table = inventory.tables.get(qualifyTable(row.table_schema, row.table_name));
		const column = table?.columns.get(row.column_name);
		if (column) {
			column.primaryKey = true;
		}
	}
	for (const indexRow of indexRows) {
		inventory.tables
			.get(qualifyTable(indexRow.table_schema, indexRow.table_name))
			?.indexes.set(
				indexRow.indexname,
				parseIndexDefinition(indexRow.indexname, indexRow.indexdef),
			);
	}
	for (const constraintRow of constraintRows) {
		inventory.tables
			.get(qualifyTable(constraintRow.table_schema, constraintRow.table_name))
			?.constraints.add(constraintRow.constraint_name);
	}

	const journalRelation = "drizzle.app_api_migrations";
	const { rows: journalExistsRows } = await client.query(
		"select to_regclass($1) as journal_table",
		[journalRelation],
	);
	if (journalExistsRows[0]?.journal_table) {
		const { rows: journalRows } = await client.query(
			'select hash, created_at from "drizzle"."app_api_migrations" order by created_at asc',
		);
		inventory.journalRows = journalRows.map((row) => ({
			createdAt: Number(row.created_at),
			hash: row.hash,
		}));
	}

	return inventory;
}

export async function inspectSharedDatabase({ connectionString, sslMode = "require" }) {
	const client = new pg.Client({
		connectionString,
		ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
	});
	await client.connect();
	try {
		return await readDatabaseInventory(client);
	} finally {
		await client.end();
	}
}
