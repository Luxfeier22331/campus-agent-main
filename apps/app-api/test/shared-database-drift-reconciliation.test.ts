// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildExpectedTableSpecs,
	loadMigrationContext,
	makeInventory,
} from "../scripts/adopt-shared-database.mjs";
import { buildSharedDatabaseDriftReconcilePlan } from "../scripts/reconcile-shared-db-drift.mjs";

const migrationContext = loadMigrationContext();
function requireSnapshot(key: string) {
	const snapshot = migrationContext.snapshots.get(key);
	if (!snapshot) {
		throw new Error(`Missing snapshot ${key}`);
	}
	return snapshot;
}

const snapshot0009 = requireSnapshot("0009_melted_nightmare");
const latestSpecs = buildExpectedTableSpecs(migrationContext.latestSnapshot);
const snapshot0009Specs = buildExpectedTableSpecs(snapshot0009);
const DINING_TABLES = [
	"dining.audit_events",
	"dining.draft_versions",
	"dining.floors",
	"dining.halls",
	"dining.menu_items",
	"dining.menu_offerings",
	"dining.release_candidate_validation_reports",
	"dining.release_candidates",
	"dining.release_latest_pointer",
	"dining.release_schedule_jobs",
	"dining.release_snapshots",
	"dining.releases",
	"dining.source_observations",
	"dining.stall_profiles",
	"dining.window_assignments",
	"dining.windows",
];

interface DropTableOperationProjection {
	kind: "drop_table";
	qualifiedName: string;
	statement: string;
}

interface ExpectedTableProjection {
	schema: string;
	table: string;
	columns: Array<{
		name: string;
		notNull: boolean;
		primaryKey: boolean;
		type: string;
	}>;
	constraints: string[];
	indexes: Array<{
		name: string;
		columns: string[];
		method: string | null;
		unique: boolean | null;
	}>;
}

function isDropTableOperation<T extends { kind: string }>(
	operation: T,
): operation is T & DropTableOperationProjection {
	return (
		operation.kind === "drop_table" && "qualifiedName" in operation && "statement" in operation
	);
}

function buildTableFromSnapshot(
	specs: ReturnType<typeof buildExpectedTableSpecs>,
	qualifiedName: string,
) {
	const spec = specs.get(qualifiedName);
	if (!spec) {
		throw new Error(`Missing expected table spec for ${qualifiedName}`);
	}

	return {
		schema: spec.schema,
		table: spec.table,
		columns: [...spec.columns.values()],
		constraints: [...spec.constraints],
		indexes: [...spec.indexes.values()],
	};
}

function buildTableFromExpected(qualifiedName: string) {
	return buildTableFromSnapshot(latestSpecs, qualifiedName);
}

function buildAllExpectedTables() {
	return [...latestSpecs.keys()].map((qualifiedName) => buildTableFromExpected(qualifiedName));
}

function tableName(table: ExpectedTableProjection) {
	return `${table.schema}.${table.table}`;
}

function withLegacyColumn(
	table: ExpectedTableProjection,
	input: { fromColumn: string; keepTarget?: boolean; toColumn: string },
) {
	const targetColumn = table.columns.find((column) => column.name === input.toColumn);
	if (!targetColumn) {
		throw new Error(`Missing expected column ${tableName(table)}.${input.toColumn}`);
	}

	return {
		...table,
		columns: [
			...table.columns.filter((column) => input.keepTarget || column.name !== input.toColumn),
			{
				...targetColumn,
				name: input.fromColumn,
			},
		],
	};
}

function withLegacyColumns(
	table: ExpectedTableProjection,
	renames: Array<{ fromColumn: string; keepTarget?: boolean; toColumn: string }>,
) {
	return renames.reduce((currentTable, rename) => withLegacyColumn(currentTable, rename), table);
}

describe("shared database drift reconciliation", () => {
	it("treats dining operations tables as current repo truth", () => {
		expect([...latestSpecs.keys()]).toEqual(expect.arrayContaining(DINING_TABLES));

		const inventory = makeInventory({
			journalRows: migrationContext.migrations.map((migration) => ({
				createdAt: migration.folderMillis,
				hash: migration.hash,
			})),
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: buildAllExpectedTables(),
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(
			plan.extraTables.filter((item: { qualifiedName: string }) =>
				item.qualifiedName.startsWith("dining."),
			),
		).toEqual([]);
	});

	it("plans cleanup for the known retired official-web orphaned journal shape", () => {
		const inventory = makeInventory({
			journalRows: [
				...migrationContext.migrations.map((migration) => ({
					createdAt: migration.folderMillis,
					hash: migration.hash,
				})),
				{
					createdAt: 1774879434946,
					hash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
				},
			],
			schemas: ["official_web", "operator", "runtime"],
			tables: buildAllExpectedTables(),
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.extraColumns).toEqual([]);
		expect(plan.extraTables).toEqual([]);
		expect(plan.orphanedJournalRows.map((row: { hash: string }) => row.hash)).toEqual([
			"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		]);
		expect(plan.operations.map((operation) => operation.kind)).toEqual(["delete_journal_row"]);
		expect(plan.nonEmptyDriftTables).toEqual([]);
	});

	it("blocks unknown extra columns and tables outside the retired drift shape", () => {
		const inventory = makeInventory({
			journalRows: [],
			schemas: ["official_web", "operator"],
			tables: [
				{
					...buildTableFromExpected("official_web.crawl_runs"),
					columns: [
						...buildTableFromExpected("official_web.crawl_runs").columns,
						{
							name: "mystery_column",
							notNull: false,
							primaryKey: false,
							type: "text",
						},
					],
				},
				{
					columns: [
						{
							name: "id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "official_web",
					table: "future_table",
				},
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map([["official_web.future_table", 0]]),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([
			"Unknown extra table outside current repo truth: official_web.future_table",
			"Unknown extra column outside current repo truth: official_web.crawl_runs.mystery_column",
		]);
	});

	it("plans cleanup for retired runtime request_execution columns", () => {
		const inventory = makeInventory({
			journalRows: [],
			schemas: ["runtime"],
			tables: [
				{
					...buildTableFromExpected("runtime.request_execution"),
					columns: [
						...buildTableFromExpected("runtime.request_execution").columns,
						{
							name: "actor_campus_scope",
							notNull: false,
							primaryKey: false,
							type: "text",
						},
						{
							name: "actor_groups_json",
							notNull: true,
							primaryKey: false,
							type: "jsonb",
						},
					],
				},
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.extraColumns).toEqual([
			{ columnName: "actor_campus_scope", qualifiedName: "runtime.request_execution" },
			{ columnName: "actor_groups_json", qualifiedName: "runtime.request_execution" },
		]);
		expect(plan.operations.map((operation) => operation.kind)).toEqual([
			"drop_column",
			"drop_column",
		]);
	});

	it("plans cleanup for retired execution runtime tables with non-empty approval surfaced", () => {
		const inventory = makeInventory({
			journalRows: [],
			schemas: ["runtime"],
			tables: [
				...buildAllExpectedTables().filter((table) => table.schema === "runtime"),
				{
					columns: [
						{
							name: "lane",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "lane_budgets",
				},
				{
					columns: [
						{
							name: "event_id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "agent_run_events",
				},
				{
					columns: [
						{
							name: "run_id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "agent_runs",
				},
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map([
				["runtime.agent_run_events", 0],
				["runtime.agent_runs", 0],
				["runtime.lane_budgets", 1],
			]),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.extraTables).toEqual([
			{ qualifiedName: "runtime.agent_run_events", rowCount: 0 },
			{ qualifiedName: "runtime.agent_runs", rowCount: 0 },
			{ qualifiedName: "runtime.lane_budgets", rowCount: 1 },
		]);
		expect(plan.nonEmptyDriftTables).toEqual([
			{ qualifiedName: "runtime.lane_budgets", rowCount: 1 },
		]);
		expect(plan.operations.map((operation) => operation.kind)).toEqual([
			"drop_table",
			"drop_table",
			"drop_table",
		]);
		expect(
			plan.operations.filter(isDropTableOperation).map((operation) => ({
				qualifiedName: operation.qualifiedName,
				statement: operation.statement,
			})),
		).toEqual([
			{
				qualifiedName: "runtime.agent_run_events",
				statement: 'drop table if exists "runtime"."agent_run_events" cascade',
			},
			{
				qualifiedName: "runtime.agent_runs",
				statement: 'drop table if exists "runtime"."agent_runs" cascade',
			},
			{
				qualifiedName: "runtime.lane_budgets",
				statement: 'drop table if exists "runtime"."lane_budgets" cascade',
			},
		]);
	});

	it("allows execution-control-owned run projection step tables to coexist in shared runtime schema", () => {
		const inventory = makeInventory({
			journalRows: [],
			schemas: ["runtime"],
			tables: [
				...buildAllExpectedTables().filter((table) => table.schema === "runtime"),
				{
					columns: [
						{
							name: "step_id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "agent_run_steps",
				},
				{
					columns: [
						{
							name: "attempt_id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "agent_step_attempts",
				},
				{
					columns: [
						{
							name: "result_id",
							notNull: true,
							primaryKey: true,
							type: "text",
						},
					],
					constraints: [],
					indexes: [],
					schema: "runtime",
					table: "agent_step_results",
				},
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map([
				["runtime.agent_run_steps", 1],
				["runtime.agent_step_attempts", 1],
				["runtime.agent_step_results", 1],
			]),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.extraTables).toEqual([]);
		expect(plan.operations.filter((operation) => operation.kind === "drop_table")).toEqual([]);
	});

	it("blocks journal-managed shared databases that still miss repo migrations", () => {
		const inventory = makeInventory({
			journalRows: migrationContext.migrations
				.filter((migration) => migration.tag !== "0010_windy_runaways")
				.map((migration) => ({
					createdAt: migration.folderMillis,
					hash: migration.hash,
				})),
			schemas: ["official_web", "operator"],
			tables: [
				buildTableFromSnapshot(snapshot0009Specs, "official_web.crawl_runs"),
				buildTableFromSnapshot(snapshot0009Specs, "operator.official_web_run_projection"),
				buildTableFromSnapshot(snapshot0009Specs, "operator.official_web_site_projection"),
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toContain(
			"Pending repo migrations not applied: 0010_windy_runaways",
		);
	});

	it("blocks missing expected columns even when there are no extra drift tables to clean", () => {
		const crawlRunsColumns = buildTableFromExpected("official_web.crawl_runs").columns.filter(
			(column) => column.name !== "run_intent" && column.name !== "ingestion_execution_status",
		);
		const runProjectionColumns = buildTableFromExpected(
			"operator.official_web_run_projection",
		).columns.filter(
			(column) => column.name !== "run_intent" && column.name !== "ingestion_execution_status",
		);

		const inventory = makeInventory({
			journalRows: [],
			schemas: ["official_web", "operator"],
			tables: [
				{
					...buildTableFromExpected("official_web.crawl_runs"),
					columns: crawlRunsColumns,
				},
				{
					...buildTableFromExpected("operator.official_web_run_projection"),
					columns: runProjectionColumns,
				},
			],
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual(
			expect.arrayContaining([
				"Missing column from current repo truth: official_web.crawl_runs.run_intent",
				"Missing column from current repo truth: official_web.crawl_runs.ingestion_execution_status",
				"Missing column from current repo truth: operator.official_web_run_projection.run_intent",
				"Missing column from current repo truth: operator.official_web_run_projection.ingestion_execution_status",
			]),
		);
	});

	it("repairs journal hash drift when schema already matches current repo truth", () => {
		const staleHashRows = migrationContext.migrations.map((migration, index) => ({
			createdAt: migration.folderMillis,
			hash:
				index >= migrationContext.migrations.length - 6
					? `${String(index).padStart(64, "0")}`
					: migration.hash,
		}));
		const inventory = makeInventory({
			journalRows: staleHashRows,
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: buildAllExpectedTables(),
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.pendingMigrationTags).toEqual(
			migrationContext.migrations.slice(-6).map((migration) => migration.tag),
		);
		expect(
			plan.operations.filter((operation) => operation.kind === "delete_journal_row"),
		).toHaveLength(6);
		expect(
			plan.operations.filter((operation) => operation.kind === "insert_journal_row"),
		).toHaveLength(6);
	});

	it("repairs known legacy capability and provider column names without dropping data", () => {
		const legacyTables = buildAllExpectedTables().map((table) => {
			switch (tableName(table)) {
				case "operator.request_projection":
					return withLegacyColumns(table, [
						{ fromColumn: "requested_capability", toColumn: "requested_tool" },
						{ fromColumn: "selected_capability", toColumn: "selected_tool" },
					]);
				case "provider_config.connections":
					return withLegacyColumns(table, [
						{ fromColumn: "capabilities_json", toColumn: "features_json" },
						{ fromColumn: "capability_config_json", toColumn: "feature_config_json" },
					]);
				case "runtime.request_observability_fact":
					return withLegacyColumns(table, [
						{ fromColumn: "intent_capability", toColumn: "intent_tool" },
						{ fromColumn: "requested_capability", toColumn: "requested_tool" },
						{
							fromColumn: "selected_capability",
							keepTarget: true,
							toColumn: "selected_tool",
						},
					]);
				default:
					return table;
			}
		});
		const staleHashRows = migrationContext.migrations
			.filter(
				(migration) =>
					migration.tag !== "0035_tool_naming" &&
					migration.tag !== "0046_provider_config_connections",
			)
			.map((migration) => ({
				createdAt: migration.folderMillis,
				hash: migration.hash,
			}));
		const inventory = makeInventory({
			journalRows: staleHashRows,
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: legacyTables,
		});

		const plan = buildSharedDatabaseDriftReconcilePlan({
			extraTableRowCounts: new Map(),
			inventory,
			migrationContext,
		});

		expect(plan.blockedReasons).toEqual([]);
		expect(plan.legacyColumnResolutions).toEqual(
			expect.arrayContaining([
				{
					fromColumn: "requested_capability",
					kind: "rename_legacy_column",
					qualifiedName: "operator.request_projection",
					toColumn: "requested_tool",
				},
				{
					fromColumn: "capabilities_json",
					kind: "rename_legacy_column",
					qualifiedName: "provider_config.connections",
					toColumn: "features_json",
				},
				{
					fromColumn: "selected_capability",
					kind: "merge_drop_legacy_column",
					qualifiedName: "runtime.request_observability_fact",
					toColumn: "selected_tool",
				},
			]),
		);
		expect(plan.missingColumns).toEqual([]);
		expect(plan.extraColumns).toEqual([]);
		expect(plan.operations.filter((operation) => operation.kind === "rename_column")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fromColumn: "requested_capability",
					qualifiedName: "operator.request_projection",
					toColumn: "requested_tool",
				}),
				expect.objectContaining({
					fromColumn: "capabilities_json",
					qualifiedName: "provider_config.connections",
					toColumn: "features_json",
				}),
			]),
		);
		expect(plan.operations.filter((operation) => operation.kind === "copy_legacy_column")).toEqual([
			expect.objectContaining({
				fromColumn: "selected_capability",
				qualifiedName: "runtime.request_observability_fact",
				toColumn: "selected_tool",
			}),
		]);
		expect(plan.pendingMigrationTags).toEqual([
			"0035_tool_naming",
			"0046_provider_config_connections",
		]);
		expect(
			plan.operations
				.filter((operation) => operation.kind === "insert_journal_row")
				.map((operation) => "tag" in operation && operation.tag),
		).toEqual(["0035_tool_naming", "0046_provider_config_connections"]);
	});
});
