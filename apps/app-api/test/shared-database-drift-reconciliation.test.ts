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

describe("shared database drift reconciliation", () => {
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
});
