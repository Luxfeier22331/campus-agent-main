import { buildExpectedTableSpecs } from "./adopt-shared-database-context.mjs";
import {
	classifySharedDatabaseState,
	cloneInventory,
	validateInventoryAgainstExpectedTables,
} from "./adopt-shared-database-inventory.mjs";
import {
	ALTER_INDEX_RENAME_RE,
	ALTER_TABLE_ADD_COLUMN_RE,
	ALTER_TABLE_CONSTRAINT_RE,
	ALTER_TABLE_DROP_COLUMN_DEFAULT_RE,
	ALTER_TABLE_DROP_COLUMN_NOT_NULL_RE,
	ALTER_TABLE_DROP_COLUMN_RE,
	ALTER_TABLE_RENAME_COLUMN_RE,
	ALTER_TABLE_SET_COLUMN_NOT_NULL_RE,
	CREATE_INDEX_RE,
	CREATE_SCHEMA_RE,
	CREATE_TABLE_RE,
	compareIndexSpec,
	DROP_INDEX_RE,
	DROP_TABLE_RE,
	INSERT_INTO_RE,
	normalizePostgresIdentifier,
	qualifyTable,
	UPDATE_TABLE_RE,
} from "./adopt-shared-database-shared.mjs";

export function parseMigrationStatement(statement) {
	const trimmed = statement.trim();
	let match = trimmed.match(CREATE_SCHEMA_RE);
	if (match) {
		return {
			existsKey: match[1],
			kind: "schema",
			schema: match[1],
			statement: trimmed,
		};
	}
	match = trimmed.match(CREATE_TABLE_RE);
	if (match) {
		return {
			existsKey: qualifyTable(match[1], match[2]),
			kind: "table",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_ADD_COLUMN_RE);
	if (match) {
		return {
			column: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}`,
			kind: "column",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_DROP_COLUMN_RE);
	if (match) {
		return {
			column: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}`,
			kind: "drop_column",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_DROP_COLUMN_DEFAULT_RE);
	if (match) {
		return {
			column: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}:default_dropped`,
			kind: "drop_column_default",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_DROP_COLUMN_NOT_NULL_RE);
	if (match) {
		return {
			column: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}:not_null_dropped`,
			kind: "drop_column_not_null",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_SET_COLUMN_NOT_NULL_RE);
	if (match) {
		return {
			column: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}:${match[3]}:not_null_set`,
			kind: "set_column_not_null",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(DROP_TABLE_RE);
	if (match) {
		return {
			existsKey: qualifyTable(match[1], match[2]),
			kind: "drop_table",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(ALTER_TABLE_RENAME_COLUMN_RE);
	if (match) {
		return {
			existsKey: `${qualifyTable(match[1], match[2])}:${match[4]}`,
			fromColumn: match[3],
			kind: "rename_column",
			schema: match[1],
			statement: trimmed,
			table: match[2],
			toColumn: match[4],
		};
	}
	match = trimmed.match(ALTER_TABLE_CONSTRAINT_RE);
	if (match) {
		return {
			constraint: match[3],
			existsKey: `${qualifyTable(match[1], match[2])}#${match[3]}`,
			kind: "constraint",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(CREATE_INDEX_RE);
	if (match) {
		return {
			existsKey: `${qualifyTable(match[2], match[3])}@${match[1]}`,
			index: match[1],
			kind: "index",
			schema: match[2],
			statement: trimmed,
			table: match[3],
		};
	}
	match = trimmed.match(DROP_INDEX_RE);
	if (match) {
		return {
			existsKey: `${match[1]}@${match[2]}`,
			index: match[2],
			kind: "drop_index",
			schema: match[1],
			statement: trimmed,
		};
	}
	match = trimmed.match(ALTER_INDEX_RENAME_RE);
	if (match) {
		return {
			existsKey: `${match[1]}@${match[3]}`,
			fromIndex: match[2],
			index: match[3],
			kind: "rename_index",
			schema: match[1],
			statement: trimmed,
		};
	}
	match = trimmed.match(INSERT_INTO_RE);
	if (match) {
		return {
			existsKey: `${qualifyTable(match[1], match[2])}:data_insert`,
			kind: "data_statement",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	match = trimmed.match(UPDATE_TABLE_RE);
	if (match) {
		return {
			existsKey: `${qualifyTable(match[1], match[2])}:data_update`,
			kind: "data_statement",
			schema: match[1],
			statement: trimmed,
			table: match[2],
		};
	}
	throw new Error(`Unsupported migration statement shape: ${trimmed}`);
}

function findInventoryIndex(inventory, target) {
	if (target.kind === "index") {
		const table = inventory.tables.get(qualifyTable(target.schema, target.table));
		const index = table ? readTableIndex(table, target.index) : null;
		return table && index ? { index, table } : null;
	}

	for (const table of inventory.tables.values()) {
		if (table.schema !== target.schema) {
			continue;
		}
		const index = readTableIndex(table, target.index);
		if (index) {
			return { index, table };
		}
	}

	return null;
}

function readTableIndex(table, indexName) {
	return (
		table.indexes.get(indexName) ??
		table.indexes.get(normalizePostgresIdentifier(indexName)) ??
		null
	);
}

function findExpectedIndex(expectedTablesForMigration, target) {
	if (target.kind === "index") {
		return (
			expectedTablesForMigration
				.get(qualifyTable(target.schema, target.table))
				?.indexes.get(target.index) ?? null
		);
	}

	for (const table of expectedTablesForMigration.values()) {
		if (table.schema !== target.schema) {
			continue;
		}
		const index = table.indexes.get(target.index);
		if (index) {
			return index;
		}
	}

	return null;
}

function targetExists(inventory, target) {
	if (target.kind === "schema") {
		return inventory.schemas.has(target.schema);
	}
	if (target.kind === "drop_index") {
		return [...inventory.tables.values()].some(
			(table) => table.schema === target.schema && readTableIndex(table, target.index),
		);
	}
	if (target.kind === "rename_index") {
		return [...inventory.tables.values()].some(
			(table) => table.schema === target.schema && readTableIndex(table, target.index),
		);
	}
	const qualifiedName = qualifyTable(target.schema, target.table);
	const table = inventory.tables.get(qualifiedName);
	if (target.kind === "table") {
		return table !== undefined;
	}
	if (target.kind === "data_statement") {
		return false;
	}
	if (target.kind === "drop_table") {
		return table === undefined;
	}
	if (!table) {
		return false;
	}
	if (target.kind === "column") {
		return table.columns.has(target.column);
	}
	if (target.kind === "drop_column_default") {
		const column = table.columns.get(target.column);
		return Boolean(column && column.defaultValue !== null && column.defaultValue !== undefined);
	}
	if (target.kind === "drop_column_not_null") {
		const column = table.columns.get(target.column);
		return Boolean(column?.notNull);
	}
	if (target.kind === "set_column_not_null") {
		const column = table.columns.get(target.column);
		return Boolean(column?.notNull);
	}
	if (target.kind === "drop_column") {
		return !table.columns.has(target.column);
	}
	if (target.kind === "rename_column") {
		return table.columns.has(target.toColumn);
	}
	if (target.kind === "constraint") {
		const normalizedConstraint = normalizePostgresIdentifier(target.constraint);
		return table.constraints.has(target.constraint) || table.constraints.has(normalizedConstraint);
	}
	if (target.kind === "index") {
		return Boolean(readTableIndex(table, target.index));
	}
	return false;
}

function latestSnapshotKeepsTable(expectedLatestTables, target) {
	if (target.kind !== "table") {
		return true;
	}
	return expectedLatestTables.has(qualifyTable(target.schema, target.table));
}

function latestSnapshotKeepsColumn(expectedLatestTables, target) {
	if (target.kind !== "column") {
		return true;
	}
	return (
		expectedLatestTables
			.get(qualifyTable(target.schema, target.table))
			?.columns.has(target.column) ?? false
	);
}

function columnKey(schema, table, column) {
	return `${qualifyTable(schema, table)}:${column}`;
}

function latestSnapshotKeepsIndex(expectedLatestTables, target) {
	if (target.kind !== "index") {
		return true;
	}
	return (
		expectedLatestTables
			.get(qualifyTable(target.schema, target.table))
			?.indexes.has(target.index) ?? false
	);
}

function latestSnapshotHasRenamedIndex(expectedLatestTables, target, renameIndexTargetBySourceKey) {
	if (target.kind !== "index") {
		return false;
	}
	const renamedIndex = renameIndexTargetBySourceKey.get(`${target.schema}@${target.index}`);
	if (!renamedIndex) {
		return false;
	}

	for (const table of expectedLatestTables.values()) {
		if (table.schema === target.schema && table.indexes.has(renamedIndex)) {
			return true;
		}
	}
	return false;
}

function shouldApplyStatement(
	inventory,
	target,
	expectedTablesForMigration,
	expectedLatestTables,
	migrationHasPlannedStructuralStatement,
	renameColumnSourceKeys,
	renameIndexSourceKeys,
	renameIndexTargetBySourceKey,
	originalTableKeys,
) {
	if (target.kind === "drop_index") {
		const actualIndex = findInventoryIndex(inventory, target);
		if (!actualIndex) {
			return false;
		}
		const expectedIndex = findExpectedIndex(expectedTablesForMigration, target);
		if (!expectedIndex) {
			return true;
		}
		return !compareIndexSpec(actualIndex.index, expectedIndex);
	}
	if (target.kind === "index") {
		if (
			originalTableKeys.has(qualifyTable(target.schema, target.table)) &&
			latestSnapshotHasRenamedIndex(expectedLatestTables, target, renameIndexTargetBySourceKey)
		) {
			return false;
		}
		if (
			!(
				latestSnapshotKeepsIndex(expectedLatestTables, target) ||
				targetExists(inventory, target) ||
				renameIndexSourceKeys.has(`${target.schema}@${target.index}`)
			)
		) {
			return false;
		}
		return !targetExists(inventory, target);
	}
	if (target.kind === "rename_index") {
		if (targetExists(inventory, target)) {
			return false;
		}
		return inventoryHasSchemaIndex(inventory, target.schema, target.fromIndex);
	}
	if (target.kind === "table" && !latestSnapshotKeepsTable(expectedLatestTables, target)) {
		return false;
	}
	if (
		target.kind === "column" &&
		!(
			latestSnapshotKeepsColumn(expectedLatestTables, target) ||
			renameColumnSourceKeys.has(columnKey(target.schema, target.table, target.column))
		)
	) {
		return false;
	}
	if (target.kind === "drop_column_default") {
		return targetExists(inventory, target);
	}
	if (target.kind === "drop_column_not_null") {
		return targetExists(inventory, target);
	}
	if (target.kind === "set_column_not_null") {
		return !targetExists(inventory, target);
	}
	if (target.kind === "data_statement") {
		return (
			migrationHasPlannedStructuralStatement &&
			targetExists(inventory, target.table ? { ...target, kind: "table" } : target)
		);
	}
	return !targetExists(inventory, target);
}

function buildSimulatedTable(spec) {
	return {
		columns: new Map(
			[...spec.columns.entries()].map(([columnName, column]) => [columnName, { ...column }]),
		),
		constraints: new Set(),
		indexes: new Map(),
		schema: spec.schema,
		table: spec.table,
	};
}

function applyTargetToInventory(inventory, target, expectedTablesForMigration) {
	if (target.kind === "schema") {
		inventory.schemas.add(target.schema);
		return;
	}

	if (target.kind === "drop_index") {
		for (const table of inventory.tables.values()) {
			if (table.schema === target.schema) {
				table.indexes.delete(target.index);
			}
		}
		return;
	}

	if (target.kind === "rename_index") {
		for (const table of inventory.tables.values()) {
			const sourceIndex = readTableIndex(table, target.fromIndex);
			if (table.schema !== target.schema || !sourceIndex) {
				continue;
			}
			const tableName = qualifyTable(table.schema, table.table);
			const expectedIndex = expectedTablesForMigration.get(tableName)?.indexes.get(target.index);
			if (!expectedIndex) {
				throw new Error(
					`Missing expected renamed index ${tableName}@${target.index} during adoption planning`,
				);
			}
			table.indexes.delete(sourceIndex.name);
			table.indexes.set(target.index, {
				...expectedIndex,
				columns: [...expectedIndex.columns],
			});
			return;
		}
		throw new Error(
			`Missing source index ${target.schema}@${target.fromIndex} during adoption planning`,
		);
	}

	const qualifiedName = qualifyTable(target.schema, target.table);
	if (target.kind === "table") {
		const expectedTable = expectedTablesForMigration.get(qualifiedName);
		if (!expectedTable) {
			throw new Error(`Missing expected table spec for ${qualifiedName} during adoption planning`);
		}
		inventory.schemas.add(target.schema);
		inventory.tables.set(qualifiedName, buildSimulatedTable(expectedTable));
		return;
	}

	if (target.kind === "data_statement") {
		return;
	}

	if (target.kind === "drop_table") {
		inventory.tables.delete(qualifiedName);
		return;
	}

	const table = inventory.tables.get(qualifiedName);
	if (!table) {
		throw new Error(`Missing simulated table ${qualifiedName} during adoption planning`);
	}

	if (target.kind === "column") {
		const expectedColumn = expectedTablesForMigration
			.get(qualifiedName)
			?.columns.get(target.column);
		if (!expectedColumn) {
			throw new Error(
				`Missing expected column ${qualifiedName}.${target.column} during adoption planning`,
			);
		}
		table.columns.set(target.column, { ...expectedColumn });
		return;
	}

	if (target.kind === "drop_column") {
		table.columns.delete(target.column);
		return;
	}

	if (target.kind === "drop_column_default") {
		if (!table.columns.has(target.column)) {
			throw new Error(
				`Missing default-drop column ${qualifiedName}.${target.column} during adoption planning`,
			);
		}
		return;
	}

	if (target.kind === "drop_column_not_null") {
		const column = table.columns.get(target.column);
		if (!column) {
			throw new Error(
				`Missing not-null-drop column ${qualifiedName}.${target.column} during adoption planning`,
			);
		}
		column.notNull = false;
		return;
	}

	if (target.kind === "set_column_not_null") {
		const column = table.columns.get(target.column);
		if (!column) {
			throw new Error(
				`Missing not-null-set column ${qualifiedName}.${target.column} during adoption planning`,
			);
		}
		column.notNull = true;
		return;
	}

	if (target.kind === "rename_column") {
		const expectedColumn = expectedTablesForMigration
			.get(qualifiedName)
			?.columns.get(target.toColumn);
		if (!expectedColumn) {
			throw new Error(
				`Missing expected renamed column ${qualifiedName}.${target.toColumn} during adoption planning`,
			);
		}
		if (!table.columns.has(target.fromColumn)) {
			throw new Error(
				`Missing source column ${qualifiedName}.${target.fromColumn} during adoption planning`,
			);
		}
		table.columns.delete(target.fromColumn);
		table.columns.set(target.toColumn, { ...expectedColumn });
		return;
	}

	if (target.kind === "constraint") {
		table.constraints.add(target.constraint);
		return;
	}

	if (target.kind === "index") {
		const expectedIndex = expectedTablesForMigration.get(qualifiedName)?.indexes.get(target.index);
		if (!expectedIndex) {
			throw new Error(
				`Missing expected index ${qualifiedName}@${target.index} during adoption planning`,
			);
		}
		table.indexes.set(target.index, {
			...expectedIndex,
			columns: [...expectedIndex.columns],
		});
		return;
	}
}

function inventoryHasSchemaIndex(inventory, schema, indexName) {
	return [...inventory.tables.values()].some(
		(table) => table.schema === schema && readTableIndex(table, indexName),
	);
}

function renameTargetExistsForSourceIndex(inventory, target, targetIndexBySourceKey) {
	if (target.kind !== "index") {
		return false;
	}
	const targetIndex = targetIndexBySourceKey.get(`${target.schema}@${target.index}`);
	return Boolean(targetIndex && inventoryHasSchemaIndex(inventory, target.schema, targetIndex));
}

function renameTargetExistsForSourceColumn(inventory, target, targetColumnBySourceKey) {
	if (target.kind !== "column") {
		return false;
	}
	const targetColumn = targetColumnBySourceKey.get(
		columnKey(target.schema, target.table, target.column),
	);
	const table = inventory.tables.get(qualifyTable(target.schema, target.table));
	return Boolean(targetColumn && table?.columns.has(targetColumn));
}

export function buildAdoptionPlan({ inventory, migrationContext }) {
	const snapshot0000 = migrationContext.snapshots.get(migrationContext.journal.entries[0].tag);
	if (!snapshot0000) {
		throw new Error("Missing baseline drizzle snapshot for shared-db adoption");
	}
	const expectedLatestTables = buildExpectedTableSpecs(migrationContext.latestSnapshot);
	const state = classifySharedDatabaseState({
		inventory,
		snapshot0000,
		snapshotLatest: migrationContext.latestSnapshot,
	});
	const statements = [];
	const plannedInventory = cloneInventory(inventory);
	const expectedTablesByMigrationTag = new Map(
		migrationContext.migrations.map((migration) => {
			const snapshot = migrationContext.snapshots.get(migration.tag);
			if (!snapshot) {
				throw new Error(`Missing drizzle snapshot for migration ${migration.tag}`);
			}
			return [migration.tag, buildExpectedTableSpecs(snapshot)];
		}),
	);
	const renameIndexSourceKeys = new Set();
	const renameIndexTargetBySourceKey = new Map();
	const renameColumnSourceKeys = new Set();
	const renameColumnTargetBySourceKey = new Map();
	const originalTableKeys = new Set(inventory.tables.keys());
	for (const migration of migrationContext.migrations) {
		for (const statement of migration.statements) {
			const target = parseMigrationStatement(statement);
			if (target.kind === "rename_column") {
				const sourceKey = columnKey(target.schema, target.table, target.fromColumn);
				renameColumnSourceKeys.add(sourceKey);
				renameColumnTargetBySourceKey.set(sourceKey, target.toColumn);
			}
			if (target.kind === "rename_index") {
				const sourceKey = `${target.schema}@${target.fromIndex}`;
				renameIndexSourceKeys.add(sourceKey);
				renameIndexTargetBySourceKey.set(sourceKey, target.index);
			}
		}
	}
	for (const migration of migrationContext.migrations) {
		const expectedTablesForMigration = expectedTablesByMigrationTag.get(migration.tag);
		if (!expectedTablesForMigration) {
			throw new Error(`Missing expected table specs for migration ${migration.tag}`);
		}
		let migrationHasPlannedStructuralStatement = false;
		for (const statement of migration.statements) {
			const target = parseMigrationStatement(statement);
			const renameTargetAlreadyExists = renameTargetExistsForSourceIndex(
				plannedInventory,
				target,
				renameIndexTargetBySourceKey,
			);
			const renameColumnTargetAlreadyExists = renameTargetExistsForSourceColumn(
				plannedInventory,
				target,
				renameColumnTargetBySourceKey,
			);
			if (
				shouldApplyStatement(
					plannedInventory,
					target,
					expectedTablesForMigration,
					expectedLatestTables,
					migrationHasPlannedStructuralStatement,
					renameColumnTargetAlreadyExists ? new Set() : renameColumnSourceKeys,
					renameTargetAlreadyExists ? new Set() : renameIndexSourceKeys,
					renameIndexTargetBySourceKey,
					originalTableKeys,
				)
			) {
				statements.push({
					migrationTag: migration.tag,
					statement,
					target,
				});
				if (target.kind !== "data_statement") {
					migrationHasPlannedStructuralStatement = true;
				}
				applyTargetToInventory(plannedInventory, target, expectedTablesForMigration);
			}
		}
	}
	const plannedTargetKeys = new Set(statements.map((item) => item.target.existsKey));
	const mismatches = validateInventoryAgainstExpectedTables(
		plannedInventory,
		expectedLatestTables,
		plannedTargetKeys,
	);
	const journalRowsToInsert = migrationContext.migrations.filter(
		(migration) => !inventory.journalRows.some((row) => row.hash === migration.hash),
	);
	return {
		journalRowsToInsert,
		mismatches,
		state,
		statements,
	};
}
