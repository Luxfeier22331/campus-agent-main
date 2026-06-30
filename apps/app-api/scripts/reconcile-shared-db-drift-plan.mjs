import {
	APP_API_MIGRATIONS_SCHEMA,
	APP_API_MIGRATIONS_TABLE,
	buildExpectedTableSpecs,
} from "./adopt-shared-database.mjs";

const RECONCILABLE_EXTRA_TABLES = new Set([
	"official_web.page_freshness",
	"official_web.page_observations",
	"runtime.agent_run_events",
	"runtime.agent_runs",
	"runtime.conversation_run_locks",
	"runtime.execution_leases",
	"runtime.lane_budgets",
	"runtime.worker_heartbeats",
]);
const EXTERNALLY_OWNED_RUNTIME_TABLES = new Set([
	"runtime.agent_run_steps",
	"runtime.agent_step_attempts",
	"runtime.agent_step_results",
]);
const EXTRA_TABLE_DROP_ORDER = new Map([
	["runtime.agent_run_events", 10],
	["runtime.conversation_run_locks", 20],
	["runtime.execution_leases", 30],
	["runtime.agent_runs", 40],
	["runtime.lane_budgets", 50],
	["runtime.worker_heartbeats", 60],
]);
const CASCADE_DROP_EXTRA_TABLES = new Set([
	"runtime.agent_run_events",
	"runtime.agent_runs",
	"runtime.conversation_run_locks",
	"runtime.execution_leases",
	"runtime.lane_budgets",
	"runtime.worker_heartbeats",
]);
const RECONCILABLE_EXTRA_COLUMNS = new Map([
	["official_web.crawl_runs", new Set(["run_intent"])],
	["operator.official_web_run_projection", new Set(["run_intent"])],
	["runtime.request_execution", new Set(["actor_campus_scope", "actor_groups_json"])],
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
const CRAWL_RUNS_SITE_SCHEDULER_INDEX = "official_web_crawl_runs_site_scheduler_idx";

export function quoteIdentifier(identifier) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function collectExtraColumns(inventory, expectedTables) {
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

function collectMissingColumns(inventory, expectedTables) {
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

function collectExtraIndexes(inventory, expectedTables) {
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

function collectMissingIndexes(inventory, expectedTables) {
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

function columnKey(qualifiedName, columnName) {
	return `${qualifiedName}.${columnName}`;
}

function indexKey(qualifiedName, indexName) {
	return `${qualifiedName}.${indexName}`;
}

function collectLegacyColumnResolutions(inventory, expectedTables) {
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

function collectLegacyIndexResolutions(inventory, expectedTables) {
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

function collectMissingTables(inventory, expectedTables) {
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

function collectOrphanedJournalRows(inventory, migrationContext) {
	const knownHashes = new Set(migrationContext.migrations.map((migration) => migration.hash));

	return inventory.journalRows
		.filter((row) => !knownHashes.has(row.hash))
		.sort((left, right) => left.createdAt - right.createdAt);
}

function collectPendingMigrations(inventory, migrationContext) {
	if (inventory.journalRows.length === 0) {
		return [];
	}

	const appliedHashes = new Set(inventory.journalRows.map((row) => row.hash));

	return migrationContext.migrations.filter((migration) => !appliedHashes.has(migration.hash));
}

function buildDropTableOperation(qualifiedName, rowCount) {
	const [schema, table] = qualifiedName.split(".", 2);
	const cascade = CASCADE_DROP_EXTRA_TABLES.has(qualifiedName) ? " cascade" : "";
	return {
		kind: "drop_table",
		qualifiedName,
		rowCount,
		statement: `drop table if exists ${quoteIdentifier(schema)}.${quoteIdentifier(table)}${cascade}`,
	};
}

function buildDropColumnOperation(qualifiedName, columnName) {
	const [schema, table] = qualifiedName.split(".", 2);
	return {
		columnName,
		kind: "drop_column",
		qualifiedName,
		statement: `alter table ${quoteIdentifier(schema)}.${quoteIdentifier(table)} drop column if exists ${quoteIdentifier(columnName)}`,
	};
}

function buildRenameColumnOperation(qualifiedName, fromColumn, toColumn) {
	const [schema, table] = qualifiedName.split(".", 2);
	return {
		fromColumn,
		kind: "rename_column",
		qualifiedName,
		statement: `alter table ${quoteIdentifier(schema)}.${quoteIdentifier(table)} rename column ${quoteIdentifier(fromColumn)} to ${quoteIdentifier(toColumn)}`,
		toColumn,
	};
}

function buildCopyLegacyColumnOperation(qualifiedName, fromColumn, toColumn) {
	const [schema, table] = qualifiedName.split(".", 2);
	return {
		fromColumn,
		kind: "copy_legacy_column",
		qualifiedName,
		statement: `update ${quoteIdentifier(schema)}.${quoteIdentifier(table)} set ${quoteIdentifier(toColumn)} = ${quoteIdentifier(fromColumn)} where ${quoteIdentifier(toColumn)} is null and ${quoteIdentifier(fromColumn)} is not null`,
		toColumn,
	};
}

function buildRenameIndexOperation(qualifiedName, fromIndex, toIndex) {
	const [schema] = qualifiedName.split(".", 2);
	return {
		fromIndex,
		kind: "rename_index",
		qualifiedName,
		statement: `alter index if exists ${quoteIdentifier(schema)}.${quoteIdentifier(fromIndex)} rename to ${quoteIdentifier(toIndex)}`,
		toIndex,
	};
}

function buildCreateIndexOperation(qualifiedName, indexSpec) {
	const [schema, table] = qualifiedName.split(".", 2);
	const columns = indexSpec.columns.map((column) => quoteIdentifier(column)).join(", ");
	const unique = indexSpec.unique ? "unique " : "";
	const method = indexSpec.method ?? "btree";
	return {
		indexName: indexSpec.name,
		kind: "create_index",
		qualifiedName,
		statement: `create ${unique}index ${quoteIdentifier(indexSpec.name)} on ${quoteIdentifier(schema)}.${quoteIdentifier(table)} using ${method} (${columns})`,
	};
}

function buildDeleteJournalRowOperation(hash) {
	return {
		hash,
		kind: "delete_journal_row",
		statement: `delete from ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} where "hash" = $1`,
	};
}

function buildInsertJournalRowOperation(migration) {
	return {
		createdAt: migration.folderMillis,
		hash: migration.hash,
		kind: "insert_journal_row",
		statement: `insert into ${quoteIdentifier(APP_API_MIGRATIONS_SCHEMA)}.${quoteIdentifier(APP_API_MIGRATIONS_TABLE)} ("hash", "created_at") values ($1, $2)`,
		tag: migration.tag,
	};
}

function readAllowedExtraColumns(qualifiedName) {
	return RECONCILABLE_EXTRA_COLUMNS.get(qualifiedName) ?? new Set();
}

export function buildSharedDatabaseDriftReconcilePlan({
	extraTableRowCounts = new Map(),
	inventory,
	migrationContext,
}) {
	const expectedTables = buildExpectedTableSpecs(migrationContext.latestSnapshot);
	const legacyColumnResolutions = collectLegacyColumnResolutions(inventory, expectedTables);
	const legacyIndexResolutions = collectLegacyIndexResolutions(inventory, expectedTables);
	const resolvedExtraColumnKeys = new Set(
		legacyColumnResolutions.map((item) => columnKey(item.qualifiedName, item.fromColumn)),
	);
	const resolvedMissingColumnKeys = new Set(
		legacyColumnResolutions
			.filter((item) => item.kind === "rename_legacy_column")
			.map((item) => columnKey(item.qualifiedName, item.toColumn)),
	);
	const extraColumns = collectExtraColumns(inventory, expectedTables).filter(
		(item) => !resolvedExtraColumnKeys.has(columnKey(item.qualifiedName, item.columnName)),
	);
	const missingColumns = collectMissingColumns(inventory, expectedTables).filter(
		(item) => !resolvedMissingColumnKeys.has(columnKey(item.qualifiedName, item.columnName)),
	);
	const resolvedExtraIndexKeys = new Set(
		legacyIndexResolutions
			.filter((item) => item.kind === "rename_legacy_index")
			.map((item) => indexKey(item.qualifiedName, item.fromIndex)),
	);
	const resolvedMissingIndexKeys = new Set(
		legacyIndexResolutions.map((item) => indexKey(item.qualifiedName, item.toIndex)),
	);
	const extraIndexes = collectExtraIndexes(inventory, expectedTables).filter(
		(item) => !resolvedExtraIndexKeys.has(indexKey(item.qualifiedName, item.indexName)),
	);
	const missingIndexes = collectMissingIndexes(inventory, expectedTables).filter(
		(item) => !resolvedMissingIndexKeys.has(indexKey(item.qualifiedName, item.indexName)),
	);
	const extraTables = collectExtraTables(inventory, expectedTables);
	const missingTables = collectMissingTables(inventory, expectedTables);
	const orphanedJournalRows = collectOrphanedJournalRows(inventory, migrationContext);
	const pendingMigrations = collectPendingMigrations(inventory, migrationContext);
	const pendingMigrationTags = pendingMigrations.map((migration) => migration.tag);
	const blockedReasons = [];
	const unresolvedSchemaDriftReasons = [];
	const operations = [];

	const orderedExtraTables = [...extraTables].sort(
		(left, right) =>
			(EXTRA_TABLE_DROP_ORDER.get(left) ?? 1000) - (EXTRA_TABLE_DROP_ORDER.get(right) ?? 1000) ||
			left.localeCompare(right),
	);
	for (const qualifiedName of orderedExtraTables) {
		if (!RECONCILABLE_EXTRA_TABLES.has(qualifiedName)) {
			unresolvedSchemaDriftReasons.push(
				`Unknown extra table outside current repo truth: ${qualifiedName}`,
			);
			continue;
		}

		operations.push(
			buildDropTableOperation(qualifiedName, extraTableRowCounts.get(qualifiedName) ?? 0),
		);
	}

	let crawlRunsNeedsIndexRebuild = false;

	for (const item of legacyColumnResolutions) {
		if (item.kind === "rename_legacy_column") {
			operations.push(
				buildRenameColumnOperation(item.qualifiedName, item.fromColumn, item.toColumn),
			);
			continue;
		}
		operations.push(
			buildCopyLegacyColumnOperation(item.qualifiedName, item.fromColumn, item.toColumn),
		);
		operations.push(buildDropColumnOperation(item.qualifiedName, item.fromColumn));
	}

	for (const item of legacyIndexResolutions) {
		if (item.kind === "rename_legacy_index") {
			operations.push(buildRenameIndexOperation(item.qualifiedName, item.fromIndex, item.toIndex));
			continue;
		}
		operations.push(buildCreateIndexOperation(item.qualifiedName, item.indexSpec));
	}

	for (const item of extraColumns) {
		const allowedColumns = readAllowedExtraColumns(item.qualifiedName);
		if (!allowedColumns.has(item.columnName)) {
			unresolvedSchemaDriftReasons.push(
				`Unknown extra column outside current repo truth: ${item.qualifiedName}.${item.columnName}`,
			);
			continue;
		}

		if (item.qualifiedName === "official_web.crawl_runs" && item.columnName === "run_intent") {
			crawlRunsNeedsIndexRebuild = true;
			continue;
		}

		operations.push(buildDropColumnOperation(item.qualifiedName, item.columnName));
	}

	for (const qualifiedName of missingTables) {
		unresolvedSchemaDriftReasons.push(`Missing table from current repo truth: ${qualifiedName}`);
	}

	for (const item of missingColumns) {
		unresolvedSchemaDriftReasons.push(
			`Missing column from current repo truth: ${item.qualifiedName}.${item.columnName}`,
		);
	}

	for (const item of extraIndexes) {
		unresolvedSchemaDriftReasons.push(
			`Unknown extra index outside current repo truth: ${item.qualifiedName}.${item.indexName}`,
		);
	}

	for (const item of missingIndexes) {
		unresolvedSchemaDriftReasons.push(
			`Missing index from current repo truth: ${item.qualifiedName}.${item.indexName}`,
		);
	}

	blockedReasons.push(...unresolvedSchemaDriftReasons);
	if (pendingMigrationTags.length > 0 && unresolvedSchemaDriftReasons.length > 0) {
		blockedReasons.push(`Pending repo migrations not applied: ${pendingMigrationTags.join(", ")}`);
	}

	if (crawlRunsNeedsIndexRebuild) {
		operations.push({
			indexName: CRAWL_RUNS_SITE_SCHEDULER_INDEX,
			kind: "drop_index",
			statement: `drop index if exists ${quoteIdentifier("official_web")}.${quoteIdentifier(CRAWL_RUNS_SITE_SCHEDULER_INDEX)}`,
		});
		operations.push(buildDropColumnOperation("official_web.crawl_runs", "run_intent"));
		operations.push({
			indexName: CRAWL_RUNS_SITE_SCHEDULER_INDEX,
			kind: "create_index",
			statement: `create unique index ${quoteIdentifier(CRAWL_RUNS_SITE_SCHEDULER_INDEX)} on ${quoteIdentifier("official_web")}.${quoteIdentifier("crawl_runs")} using btree ("site_id","scheduler_run_key")`,
		});
	}

	for (const row of orphanedJournalRows) {
		operations.push(buildDeleteJournalRowOperation(row.hash));
	}

	if (pendingMigrationTags.length > 0 && unresolvedSchemaDriftReasons.length === 0) {
		for (const migration of pendingMigrations) {
			operations.push(buildInsertJournalRowOperation(migration));
		}
	}

	const nonEmptyDriftTables = operations
		.filter((operation) => operation.kind === "drop_table" && operation.rowCount > 0)
		.map((operation) => ({
			qualifiedName: operation.qualifiedName,
			rowCount: operation.rowCount,
		}));

	return {
		blockedReasons,
		driftDetected:
			extraColumns.length > 0 ||
			extraTables.length > 0 ||
			missingColumns.length > 0 ||
			missingTables.length > 0 ||
			extraIndexes.length > 0 ||
			missingIndexes.length > 0 ||
			legacyColumnResolutions.length > 0 ||
			legacyIndexResolutions.length > 0 ||
			orphanedJournalRows.length > 0 ||
			pendingMigrationTags.length > 0,
		extraColumns,
		extraTables: extraTables.map((qualifiedName) => ({
			qualifiedName,
			rowCount: extraTableRowCounts.get(qualifiedName) ?? 0,
		})),
		extraIndexes,
		legacyColumnResolutions,
		legacyIndexResolutions,
		missingColumns,
		missingIndexes,
		missingTables,
		nonEmptyDriftTables,
		operations,
		orphanedJournalRows,
		pendingMigrationTags,
	};
}

export function formatSharedDatabaseDriftReconcilePlan(plan) {
	return JSON.stringify(
		{
			blockedReasons: plan.blockedReasons,
			driftDetected: plan.driftDetected,
			extraColumns: plan.extraColumns,
			extraIndexes: plan.extraIndexes,
			extraTables: plan.extraTables,
			legacyColumnResolutions: plan.legacyColumnResolutions,
			legacyIndexResolutions: plan.legacyIndexResolutions,
			missingColumns: plan.missingColumns,
			missingIndexes: plan.missingIndexes,
			missingTables: plan.missingTables,
			nonEmptyDriftTables: plan.nonEmptyDriftTables,
			operations: plan.operations.map((operation) => {
				if (operation.kind === "delete_journal_row") {
					return {
						hash: operation.hash,
						kind: operation.kind,
					};
				}

				if (operation.kind === "insert_journal_row") {
					return {
						hash: operation.hash,
						kind: operation.kind,
						tag: operation.tag,
					};
				}

				return {
					kind: operation.kind,
					qualifiedName: "qualifiedName" in operation ? operation.qualifiedName : null,
					statement: operation.statement,
				};
			}),
			orphanedJournalRows: plan.orphanedJournalRows,
			pendingMigrationTags: plan.pendingMigrationTags,
		},
		null,
		2,
	);
}
