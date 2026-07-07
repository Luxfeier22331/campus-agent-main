const EXTERNALLY_OWNED_RUNTIME_TABLES = new Set([
	"runtime.agent_run_steps",
	"runtime.agent_step_attempts",
	"runtime.agent_step_results",
]);

const LEGACY_COLUMN_RENAMES = [
	{
		fromColumn: "requested_capability",
		qualifiedName: "operator.metric_rollup",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "operator.metric_rollup",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "operator.quality_badcase_projection",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "requested_capability",
		qualifiedName: "operator.quality_grade_projection",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "operator.quality_grade_projection",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "requested_capability",
		qualifiedName: "operator.request_audit_projection",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "operator.request_audit_projection",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "requested_capability",
		qualifiedName: "operator.request_projection",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "operator.request_projection",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "capabilities_json",
		qualifiedName: "provider_config.connections",
		toColumn: "features_json",
	},
	{
		fromColumn: "capability_config_json",
		qualifiedName: "provider_config.connections",
		toColumn: "feature_config_json",
	},
	{
		fromColumn: "requested_capability",
		qualifiedName: "runtime.request_execution",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "runtime.request_execution",
		toColumn: "selected_tool",
	},
	{
		fromColumn: "intent_capability",
		qualifiedName: "runtime.request_observability_fact",
		toColumn: "intent_tool",
	},
	{
		fromColumn: "requested_capability",
		qualifiedName: "runtime.request_observability_fact",
		toColumn: "requested_tool",
	},
	{
		fromColumn: "selected_capability",
		qualifiedName: "runtime.request_observability_fact",
		toColumn: "selected_tool",
	},
];

const LEGACY_INDEX_RENAMES = [
	{
		fromIndex: "operator_metric_rollup_domain_capability_bucket_idx",
		qualifiedName: "operator.metric_rollup",
		toIndex: "operator_metric_rollup_domain_tool_bucket_idx",
	},
	{
		fromIndex: "runtime_request_observability_selected_capability_started_at_idx",
		qualifiedName: "runtime.request_observability_fact",
		toIndex: "runtime_request_observability_selected_tool_started_at_idx",
	},
	{
		fromIndex: "runtime_request_observability_selected_target_started_at_idx",
		qualifiedName: "runtime.request_observability_fact",
		toIndex: "runtime_request_observability_selected_tool_started_at_idx",
	},
];

export function collectExtraColumns(inventory, expectedTables) {
	const extraColumns = [];

	for (const [qualifiedName, table] of inventory.tables.entries()) {
		const expectedTable = expectedTables.get(qualifiedName);
		if (!expectedTable) {
			continue;
		}

		for (const columnName of table.columns.keys()) {
			if (!expectedTable.columns.has(columnName)) {
				extraColumns.push({
					columnName,
					qualifiedName,
				});
			}
		}
	}

	return extraColumns.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.columnName.localeCompare(right.columnName),
	);
}

export function collectMissingColumns(inventory, expectedTables) {
	const missingColumns = [];

	for (const [qualifiedName, expectedTable] of expectedTables.entries()) {
		const actualTable = inventory.tables.get(qualifiedName);
		if (!actualTable) {
			continue;
		}

		for (const columnName of expectedTable.columns.keys()) {
			if (!actualTable.columns.has(columnName)) {
				missingColumns.push({
					columnName,
					qualifiedName,
				});
			}
		}
	}

	return missingColumns.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.columnName.localeCompare(right.columnName),
	);
}

export function collectExtraIndexes(inventory, expectedTables) {
	const extraIndexes = [];

	for (const [qualifiedName, table] of inventory.tables.entries()) {
		const expectedTable = expectedTables.get(qualifiedName);
		if (!expectedTable) {
			continue;
		}

		for (const indexName of table.indexes.keys()) {
			if (table.constraints.has(indexName)) {
				continue;
			}
			if (!expectedTable.indexes.has(indexName)) {
				extraIndexes.push({
					indexName,
					qualifiedName,
				});
			}
		}
	}

	return extraIndexes.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.indexName.localeCompare(right.indexName),
	);
}

export function collectMissingIndexes(inventory, expectedTables) {
	const missingIndexes = [];

	for (const [qualifiedName, expectedTable] of expectedTables.entries()) {
		const actualTable = inventory.tables.get(qualifiedName);
		if (!actualTable) {
			continue;
		}

		for (const indexName of expectedTable.indexes.keys()) {
			if (!actualTable.indexes.has(indexName)) {
				missingIndexes.push({
					indexName,
					qualifiedName,
				});
			}
		}
	}

	return missingIndexes.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.indexName.localeCompare(right.indexName),
	);
}

export function columnKey(qualifiedName, columnName) {
	return `${qualifiedName}.${columnName}`;
}

export function indexKey(qualifiedName, indexName) {
	return `${qualifiedName}.${indexName}`;
}

export function collectLegacyColumnResolutions(inventory, expectedTables) {
	const resolutions = [];

	for (const item of LEGACY_COLUMN_RENAMES) {
		const actualTable = inventory.tables.get(item.qualifiedName);
		const expectedTable = expectedTables.get(item.qualifiedName);
		if (!(actualTable && expectedTable?.columns.has(item.toColumn))) {
			continue;
		}

		const sourceExists = actualTable.columns.has(item.fromColumn);
		if (!sourceExists) {
			continue;
		}

		resolutions.push({
			fromColumn: item.fromColumn,
			kind: actualTable.columns.has(item.toColumn)
				? "merge_drop_legacy_column"
				: "rename_legacy_column",
			qualifiedName: item.qualifiedName,
			toColumn: item.toColumn,
		});
	}

	return resolutions.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.fromColumn.localeCompare(right.fromColumn),
	);
}

export function collectLegacyIndexResolutions(inventory, expectedTables) {
	const resolutions = [];
	const groupedRenames = new Map();

	for (const item of LEGACY_INDEX_RENAMES) {
		const key = indexKey(item.qualifiedName, item.toIndex);
		const existing = groupedRenames.get(key);
		if (existing) {
			existing.fromIndexes.push(item.fromIndex);
			continue;
		}
		groupedRenames.set(key, {
			fromIndexes: [item.fromIndex],
			qualifiedName: item.qualifiedName,
			toIndex: item.toIndex,
		});
	}

	for (const item of groupedRenames.values()) {
		const actualTable = inventory.tables.get(item.qualifiedName);
		const expectedTable = expectedTables.get(item.qualifiedName);
		const expectedIndex = expectedTable?.indexes.get(item.toIndex);
		if (!(actualTable && expectedIndex)) {
			continue;
		}
		if (actualTable.indexes.has(item.toIndex)) {
			continue;
		}
		const fromIndex = item.fromIndexes.find((candidate) => actualTable.indexes.has(candidate));
		if (fromIndex) {
			resolutions.push({
				fromIndex,
				kind: "rename_legacy_index",
				qualifiedName: item.qualifiedName,
				toIndex: item.toIndex,
			});
			continue;
		}
		resolutions.push({
			indexSpec: expectedIndex,
			kind: "create_missing_index",
			qualifiedName: item.qualifiedName,
			toIndex: item.toIndex,
		});
	}

	return resolutions.sort(
		(left, right) =>
			left.qualifiedName.localeCompare(right.qualifiedName) ||
			left.toIndex.localeCompare(right.toIndex),
	);
}

export function collectExtraTables(inventory, expectedTables) {
	const extraTables = [];

	for (const qualifiedName of inventory.tables.keys()) {
		if (EXTERNALLY_OWNED_RUNTIME_TABLES.has(qualifiedName)) {
			continue;
		}
		if (!expectedTables.has(qualifiedName)) {
			extraTables.push(qualifiedName);
		}
	}

	return extraTables.sort();
}

export function collectMissingTables(inventory, expectedTables) {
	if (inventory.journalRows.length === 0) {
		return [];
	}

	const missingTables = [];

	for (const qualifiedName of expectedTables.keys()) {
		if (!inventory.tables.has(qualifiedName)) {
			missingTables.push(qualifiedName);
		}
	}

	return missingTables.sort();
}

export function collectOrphanedJournalRows(inventory, migrationContext) {
	const knownHashes = new Set(migrationContext.migrations.map((migration) => migration.hash));

	return inventory.journalRows
		.filter((row) => !knownHashes.has(row.hash))
		.sort((left, right) => left.createdAt - right.createdAt);
}

export function collectPendingMigrations(inventory, migrationContext) {
	if (inventory.journalRows.length === 0) {
		return [];
	}

	const appliedHashes = new Set(inventory.journalRows.map((row) => row.hash));

	return migrationContext.migrations.filter((migration) => !appliedHashes.has(migration.hash));
}
