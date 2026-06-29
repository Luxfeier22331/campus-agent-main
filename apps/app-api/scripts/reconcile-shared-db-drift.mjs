import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
	APP_API_MIGRATIONS_SCHEMA,
	APP_API_MIGRATIONS_TABLE,
	buildExpectedTableSpecs,
	inspectSharedDatabase,
	loadMigrationContext,
	runSharedDatabaseAdoption,
} from "./adopt-shared-database.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(scriptsDir);
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
const CRAWL_RUNS_SITE_SCHEDULER_INDEX = "official_web_crawl_runs_site_scheduler_idx";

function quoteIdentifier(identifier) {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function _qualifyName(schema, name) {
	return `${schema}.${name}`;
}

function normalizePostgresConnectionStringForExplicitSsl(connectionString) {
	const nextUrl = new URL(connectionString);
	nextUrl.searchParams.delete("sslmode");
	return nextUrl.toString();
}

function readRequiredOperatorDatabaseUrl(env = process.env) {
	const value = env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!value) {
		throw new Error(
			"APP_API_OPERATOR_DATABASE_URL is required for shared-db drift reconciliation.",
		);
	}
	return normalizePostgresConnectionStringForExplicitSsl(value);
}

function readSslMode(env = process.env) {
	return env.APP_API_DATABASE_SSLMODE?.trim() || "require";
}

function openClient({ connectionString, sslMode }) {
	return new pg.Client({
		connectionString,
		ssl: sslMode === "disable" ? false : { rejectUnauthorized: false },
	});
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

function columnKey(qualifiedName, columnName) {
	return `${qualifiedName}.${columnName}`;
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

function collectExtraTables(inventory, expectedTables) {
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
			legacyColumnResolutions.length > 0 ||
			orphanedJournalRows.length > 0 ||
			pendingMigrationTags.length > 0,
		extraColumns,
		extraTables: extraTables.map((qualifiedName) => ({
			qualifiedName,
			rowCount: extraTableRowCounts.get(qualifiedName) ?? 0,
		})),
		legacyColumnResolutions,
		missingColumns,
		missingTables,
		nonEmptyDriftTables,
		operations,
		orphanedJournalRows,
		pendingMigrationTags,
	};
}

async function readExtraTableRowCounts(client, extraTables) {
	const rowCounts = new Map();

	for (const qualifiedName of extraTables) {
		const [schema, table] = qualifiedName.split(".", 2);
		const result = await client.query(
			`select count(*)::int as count from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
		);
		rowCounts.set(qualifiedName, result.rows[0]?.count ?? 0);
	}

	return rowCounts;
}

async function readColumnBackupRows(client, qualifiedName, columns) {
	const [schema, table] = qualifiedName.split(".", 2);
	const selectList = columns.map((column) => quoteIdentifier(column)).join(", ");
	const result = await client.query(
		`select ${selectList} from ${quoteIdentifier(schema)}.${quoteIdentifier(table)} order by 1`,
	);
	return result.rows;
}

async function writeBackupArtifacts({ backupDir, client, inventory, plan }) {
	const resolvedBackupDir = resolve(appRoot, backupDir);
	await mkdir(resolvedBackupDir, { recursive: true });

	const backups = {
		generatedAt: new Date().toISOString(),
		inventory: {
			journalRows: inventory.journalRows,
			tables: [...inventory.tables.keys()].sort(),
		},
		plan,
	};
	await writeFile(
		join(resolvedBackupDir, "manifest.json"),
		`${JSON.stringify(backups, null, 2)}\n`,
	);

	for (const extraTable of plan.extraTables) {
		const [schema, table] = extraTable.qualifiedName.split(".", 2);
		const rows = await client.query(
			`select * from ${quoteIdentifier(schema)}.${quoteIdentifier(table)} order by 1`,
		);
		await writeFile(
			join(resolvedBackupDir, `${schema}__${table}.rows.json`),
			`${JSON.stringify(rows.rows, null, 2)}\n`,
		);
	}

	for (const extraColumn of plan.extraColumns) {
		const rows = await readColumnBackupRows(client, extraColumn.qualifiedName, [
			extraColumn.columnName,
		]);
		await writeFile(
			join(
				resolvedBackupDir,
				`${extraColumn.qualifiedName.replace(".", "__")}__${extraColumn.columnName}.column.json`,
			),
			`${JSON.stringify(rows, null, 2)}\n`,
		);
	}

	for (const legacyColumn of plan.legacyColumnResolutions ?? []) {
		const backupColumns =
			legacyColumn.kind === "merge_drop_legacy_column"
				? [legacyColumn.fromColumn, legacyColumn.toColumn]
				: [legacyColumn.fromColumn];
		const rows = await readColumnBackupRows(client, legacyColumn.qualifiedName, backupColumns);
		await writeFile(
			join(
				resolvedBackupDir,
				`${legacyColumn.qualifiedName.replace(".", "__")}__${legacyColumn.fromColumn}.legacy-column.json`,
			),
			`${JSON.stringify(rows, null, 2)}\n`,
		);
	}

	if (plan.orphanedJournalRows.length > 0) {
		await writeFile(
			join(resolvedBackupDir, "drizzle__app_api_migrations.orphaned.json"),
			`${JSON.stringify(plan.orphanedJournalRows, null, 2)}\n`,
		);
	}

	return resolvedBackupDir;
}

async function applySharedDatabaseDriftReconcilePlan(client, plan) {
	await client.query("begin");
	try {
		for (const operation of plan.operations) {
			if (operation.kind === "delete_journal_row") {
				await client.query(operation.statement, [operation.hash]);
				continue;
			}
			if (operation.kind === "insert_journal_row") {
				await client.query(operation.statement, [operation.hash, operation.createdAt]);
				continue;
			}

			await client.query(operation.statement);
		}
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

function formatPlan(plan) {
	return JSON.stringify(
		{
			blockedReasons: plan.blockedReasons,
			driftDetected: plan.driftDetected,
			extraColumns: plan.extraColumns,
			extraTables: plan.extraTables,
			legacyColumnResolutions: plan.legacyColumnResolutions,
			missingColumns: plan.missingColumns,
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

export async function runSharedDatabaseDriftReconcile({
	allowNonEmptyDriftTables = false,
	apply = false,
	backupDir = null,
	env = process.env,
} = {}) {
	const migrationContext = loadMigrationContext();
	const connectionString = readRequiredOperatorDatabaseUrl(env);
	const sslMode = readSslMode(env);
	const inventory = await inspectSharedDatabase({ connectionString, sslMode });
	const client = openClient({ connectionString, sslMode });
	await client.connect();

	try {
		const rowCounts = await readExtraTableRowCounts(
			client,
			collectExtraTables(inventory, buildExpectedTableSpecs(migrationContext.latestSnapshot)),
		);
		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: rowCounts,
			inventory,
			migrationContext,
		});

		if (plan.blockedReasons.length > 0) {
			throw new Error(
				`Shared database drift reconciliation blocked:\n${plan.blockedReasons.join("\n")}`,
			);
		}

		if (!allowNonEmptyDriftTables && plan.nonEmptyDriftTables.length > 0) {
			throw new Error(
				`Shared database drift reconciliation requires explicit non-empty approval:\n${plan.nonEmptyDriftTables
					.map((item) => `${item.qualifiedName} has ${item.rowCount} rows`)
					.join("\n")}`,
			);
		}

		let backupPath = null;
		if (backupDir) {
			backupPath = await writeBackupArtifacts({
				backupDir,
				client,
				inventory,
				plan,
			});
		}

		if (!apply) {
			return {
				applied: false,
				backupPath,
				plan,
			};
		}

		await applySharedDatabaseDriftReconcilePlan(client, plan);

		const reconciledInventory = await inspectSharedDatabase({ connectionString, sslMode });
		const reconciledRowCounts = await readExtraTableRowCounts(
			client,
			collectExtraTables(
				reconciledInventory,
				buildExpectedTableSpecs(migrationContext.latestSnapshot),
			),
		);
		const reconciledPlan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: reconciledRowCounts,
			inventory: reconciledInventory,
			migrationContext,
		});
		if (reconciledPlan.driftDetected || reconciledPlan.blockedReasons.length > 0) {
			throw new Error(
				`Shared database drift reconciliation did not remove all retired drift:\n${formatPlan(reconciledPlan)}`,
			);
		}

		let adoptionResult = await runSharedDatabaseAdoption({ apply: false, env });
		if (adoptionResult.plan.mismatches.length > 0) {
			throw new Error(
				`Shared database drift reconciliation did not converge to repo truth:\n${JSON.stringify(
					{
						mismatches: adoptionResult.plan.mismatches,
						statements: adoptionResult.plan.statements.map((item) => item.target.existsKey),
					},
					null,
					2,
				)}`,
			);
		}
		if (
			adoptionResult.plan.statements.length > 0 ||
			adoptionResult.plan.journalRowsToInsert.length > 0
		) {
			await runSharedDatabaseAdoption({ apply: true, env });
			adoptionResult = await runSharedDatabaseAdoption({ apply: false, env });
			if (adoptionResult.plan.mismatches.length > 0 || adoptionResult.plan.statements.length > 0) {
				throw new Error(
					`Shared database drift reconciliation did not converge to repo truth:\n${JSON.stringify(
						{
							mismatches: adoptionResult.plan.mismatches,
							statements: adoptionResult.plan.statements.map((item) => item.target.existsKey),
						},
						null,
						2,
					)}`,
				);
			}
		}

		return {
			applied: true,
			backupPath,
			plan,
		};
	} finally {
		await client.end();
	}
}

function parseArgs(argv) {
	let backupDir = null;

	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === "--backup-dir") {
			backupDir = argv[index + 1] ?? null;
		}
	}

	return {
		allowNonEmptyDriftTables: argv.includes("--allow-non-empty-drift-tables"),
		apply: argv.includes("--apply"),
		backupDir,
		json: argv.includes("--json"),
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = parseArgs(process.argv.slice(2));
	runSharedDatabaseDriftReconcile({
		allowNonEmptyDriftTables: args.allowNonEmptyDriftTables,
		apply: args.apply,
		backupDir: args.backupDir,
	})
		.then((result) => {
			const payload = {
				applied: result.applied,
				backupPath: result.backupPath,
				plan: result.plan,
			};
			if (args.json) {
				console.log(`${JSON.stringify(payload, null, 2)}\n`);
				return;
			}

			console.log(formatPlan(result.plan));
			if (result.backupPath) {
				console.log(`backup_path: ${result.backupPath}`);
			}
		})
		.catch((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
