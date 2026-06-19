// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildAdoptionPlan,
	buildExpectedTableSpecs,
	classifySharedDatabaseState,
	loadMigrationContext,
	makeInventory,
	parseMigrationStatement,
} from "../scripts/adopt-shared-database.mjs";

const migrationContext = loadMigrationContext();
function requireSnapshot(key: string) {
	const snapshot = migrationContext.snapshots.get(key);
	if (!snapshot) {
		throw new Error(`Missing snapshot ${key}`);
	}
	return snapshot;
}

const snapshot0000 = requireSnapshot("0000_funny_tiger_shark");
const snapshotLatest = migrationContext.latestSnapshot;
const snapshot0000Specs = buildExpectedTableSpecs(snapshot0000);
const latestSpecs = buildExpectedTableSpecs(snapshotLatest);

function normalizeSqlStatement(statement: string): string {
	return statement.replace(/\s+/g, " ").trim();
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

describe("shared database adoption", () => {
	it("parses supported migration statement shapes", () => {
		expect(parseMigrationStatement('CREATE SCHEMA IF NOT EXISTS "official_web";')).toMatchObject({
			existsKey: "official_web",
			kind: "schema",
		});
		expect(parseMigrationStatement('CREATE TABLE "runtime"."request_execution" (')).toMatchObject({
			existsKey: "runtime.request_execution",
			kind: "table",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "run_intent" text NOT NULL DEFAULT \'baseline\';',
			),
		).toMatchObject({
			existsKey: "official_web.crawl_runs:run_intent",
			kind: "column",
		});
		expect(
			parseMigrationStatement(`ALTER TABLE "official_web"."crawl_runs"
ADD COLUMN "run_intent" text NOT NULL DEFAULT 'baseline';`),
		).toMatchObject({
			existsKey: "official_web.crawl_runs:run_intent",
			kind: "column",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "runtime"."request_execution" ADD COLUMN "diagnostics_json" jsonb;',
			),
		).toMatchObject({
			existsKey: "runtime.request_execution:diagnostics_json",
			kind: "column",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "runtime"."request_execution" ADD COLUMN "entitlement_snapshot_id" text;',
			),
		).toMatchObject({
			existsKey: "runtime.request_execution:entitlement_snapshot_id",
			kind: "column",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "profile"."memory_items" ALTER COLUMN "runtime_episode_uuid" DROP DEFAULT;',
			),
		).toMatchObject({
			existsKey: "profile.memory_items:runtime_episode_uuid:default_dropped",
			kind: "drop_column_default",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "provider_config"."profiles" ALTER COLUMN "provider" DROP NOT NULL;',
			),
		).toMatchObject({
			existsKey: "provider_config.profiles:provider:not_null_dropped",
			kind: "drop_column_not_null",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "provider_config"."profiles" ALTER COLUMN "connection_id" SET NOT NULL;',
			),
		).toMatchObject({
			existsKey: "provider_config.profiles:connection_id:not_null_set",
			kind: "set_column_not_null",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "runtime"."request_execution" RENAME COLUMN "old_capability" TO "selected_capability";',
			),
		).toMatchObject({
			existsKey: "runtime.request_execution:selected_capability",
			fromColumn: "old_capability",
			kind: "rename_column",
			toColumn: "selected_capability",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "official_web"."run_outbox" ADD CONSTRAINT "run_outbox_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;',
			),
		).toMatchObject({
			existsKey: "official_web.run_outbox#run_outbox_run_id_crawl_runs_run_id_fk",
			kind: "constraint",
		});
		expect(
			parseMigrationStatement(`ALTER TABLE "official_web"."run_artifacts"
ADD CONSTRAINT "run_artifacts_run_id_crawl_runs_run_id_fk" FOREIGN KEY (
    "run_id"
) REFERENCES "official_web"."crawl_runs" ("run_id") ON DELETE CASCADE ON UPDATE NO ACTION;`),
		).toMatchObject({
			existsKey: "official_web.run_artifacts#run_artifacts_run_id_crawl_runs_run_id_fk",
			kind: "constraint",
		});
		expect(
			parseMigrationStatement(`ALTER TABLE "official_web"."target_release_gates"
ADD CONSTRAINT
"target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk"
FOREIGN KEY (
    "summary_id"
) REFERENCES "official_web"."target_artifact_verification_summaries" (
    "summary_id"
) ON DELETE SET NULL ON UPDATE NO ACTION;`),
		).toMatchObject({
			existsKey:
				"official_web.target_release_gates#target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk",
			kind: "constraint",
		});
		expect(
			parseMigrationStatement(
				'CREATE UNIQUE INDEX "runtime_request_execution_actor_idempotency_idx" ON "runtime"."request_execution" USING btree ("actor_user_id","idempotency_key");',
			),
		).toMatchObject({
			existsKey: "runtime.request_execution@runtime_request_execution_actor_idempotency_idx",
			kind: "index",
		});
		expect(
			parseMigrationStatement(`CREATE UNIQUE INDEX "official_web_crawl_runs_site_scheduler_idx"
ON "official_web"."crawl_runs" USING btree (
    "site_id", "scheduler_run_key"
);`),
		).toMatchObject({
			existsKey: "official_web.crawl_runs@official_web_crawl_runs_site_scheduler_idx",
			kind: "index",
		});
		expect(
			parseMigrationStatement(
				'DROP INDEX "official_web"."official_web_crawl_runs_site_scheduler_idx";',
			),
		).toMatchObject({
			existsKey: "official_web@official_web_crawl_runs_site_scheduler_idx",
			kind: "drop_index",
		});
		expect(
			parseMigrationStatement(
				'ALTER INDEX IF EXISTS "operator"."operator_metric_rollup_domain_target_bucket_idx" RENAME TO "operator_metric_rollup_domain_capability_bucket_idx";',
			),
		).toMatchObject({
			existsKey: "operator@operator_metric_rollup_domain_capability_bucket_idx",
			fromIndex: "operator_metric_rollup_domain_target_bucket_idx",
			index: "operator_metric_rollup_domain_capability_bucket_idx",
			kind: "rename_index",
		});
		expect(
			parseMigrationStatement('INSERT INTO "provider_config"."connections" ("connection_id")'),
		).toMatchObject({
			existsKey: "provider_config.connections:data_insert",
			kind: "data_statement",
		});
		expect(
			parseMigrationStatement('UPDATE "provider_config"."profiles" SET "connection_id" ='),
		).toMatchObject({
			existsKey: "provider_config.profiles:data_update",
			kind: "data_statement",
		});
		expect(
			parseMigrationStatement(
				'ALTER TABLE "runtime"."request_execution" DROP COLUMN "actor_groups_json";',
			),
		).toMatchObject({
			existsKey: "runtime.request_execution:actor_groups_json",
			kind: "drop_column",
		});
		expect(parseMigrationStatement('DROP TABLE "dining"."floorplan_assets";')).toMatchObject({
			existsKey: "dining.floorplan_assets",
			kind: "drop_table",
		});
		expect(
			parseMigrationStatement(`ALTER TABLE "runtime"."request_execution"
DROP COLUMN "actor_groups_json";`),
		).toMatchObject({
			existsKey: "runtime.request_execution:actor_groups_json",
			kind: "drop_column",
		});
	});

	it("classifies non-owned shared schemas as fresh for app-api adoption", () => {
		const inventory = makeInventory({
			schemas: ["auth", "chat"],
		});

		expect(
			classifySharedDatabaseState({
				inventory,
				snapshot0000,
				snapshotLatest,
			}),
		).toBe("fresh");
	});

	it("plans missing runtime/operator/official_web statements for shared databases without app-api-owned schemas", () => {
		const inventory = makeInventory({
			schemas: ["auth", "chat"],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(plan.mismatches).toEqual([]);
		expect(plan.state).toBe("fresh");
		expect(
			plan.statements.some((item) => item.target.existsKey === "runtime.request_execution"),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "runtime.request_observability_fact",
			),
		).toBe(true);
		expect(
			plan.statements.some((item) => item.target.existsKey === "operator.request_projection"),
		).toBe(true);
		expect(
			plan.statements.some((item) => item.target.existsKey === "official_web.crawl_runs"),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey === "official_web@official_web_crawl_runs_site_scheduler_idx",
			),
		).toBe(true);
		expect(plan.journalRowsToInsert.map((item: { tag: string }) => item.tag)).toEqual(
			migrationContext.migrations.map((item) => item.tag),
		);
	});

	it("plans stale index drops only when the pre-migration index still exists", () => {
		const inventory = makeInventory({
			schemas: ["official_web"],
			tables: [buildTableFromSnapshot(snapshot0000Specs, "official_web.crawl_runs")],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey === "official_web@official_web_crawl_runs_site_scheduler_idx",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"official_web.crawl_runs@official_web_crawl_runs_site_scheduler_idx",
			),
		).toBe(true);
	});

	it("does not replan the crawl_runs scheduler index when the latest definition already exists", () => {
		const inventory = makeInventory({
			schemas: ["official_web"],
			tables: [buildTableFromExpected("official_web.crawl_runs")],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey === "official_web@official_web_crawl_runs_site_scheduler_idx",
			),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"official_web.crawl_runs@official_web_crawl_runs_site_scheduler_idx",
			),
		).toBe(false);
	});

	it("does not create transient indexes that are already dropped by the latest snapshot", () => {
		const inventory = makeInventory({
			schemas: ["docs"],
			tables: [
				buildTableFromExpected("docs.collections"),
				buildTableFromExpected("docs.documents"),
				buildTableFromExpected("docs.document_versions"),
				buildTableFromExpected("docs.reader_assets"),
				buildTableFromExpected("docs.search_units"),
			],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "docs.search_units@docs_search_units_search_text_idx",
			),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey === "docs.search_units@docs_search_units_version_search_text_idx",
			),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "docs@docs_search_units_search_text_idx",
			),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "docs@docs_search_units_version_search_text_idx",
			),
		).toBe(false);
	});

	it("allows add-column migrations to reconcile legacy official_web tables without a journal", () => {
		const inventory = makeInventory({
			schemas: ["official_web", "operator"],
			tables: [
				buildTableFromSnapshot(snapshot0000Specs, "official_web.crawl_runs"),
				buildTableFromSnapshot(snapshot0000Specs, "operator.official_web_run_projection"),
			],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(plan.mismatches).toEqual([]);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "official_web.crawl_runs:run_intent",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "official_web.crawl_runs:ingestion_execution_status",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "operator.official_web_run_projection:run_intent",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"operator.official_web_run_projection:ingestion_execution_status",
			),
		).toBe(true);
	});

	it("backfills legacy run_intent columns with baseline during adoption", () => {
		const crawlRunsRunIntentStatement =
			'ALTER TABLE "official_web"."crawl_runs" ADD COLUMN "run_intent" text';
		const runProjectionRunIntentStatement =
			'ALTER TABLE "operator"."official_web_run_projection" ADD COLUMN "run_intent" text';
		const runIntentBackfillMigration = migrationContext.migrations.find(
			(migration) =>
				migration.statements.some(
					(statement) =>
						normalizeSqlStatement(statement).includes(crawlRunsRunIntentStatement) &&
						statement.includes("DEFAULT 'baseline'"),
				) &&
				migration.statements.some(
					(statement) =>
						normalizeSqlStatement(statement).includes(runProjectionRunIntentStatement) &&
						statement.includes("DEFAULT 'baseline'"),
				),
		);

		expect(
			runIntentBackfillMigration?.statements.some((statement) =>
				normalizeSqlStatement(statement).includes(crawlRunsRunIntentStatement),
			),
		).toBe(true);
		expect(
			runIntentBackfillMigration?.statements.some((statement) =>
				normalizeSqlStatement(statement).includes(runProjectionRunIntentStatement),
			),
		).toBe(true);
		expect(
			runIntentBackfillMigration?.statements.some(
				(statement) =>
					normalizeSqlStatement(statement).includes(crawlRunsRunIntentStatement) &&
					statement.includes("DEFAULT 'baseline'"),
			),
		).toBe(true);
		expect(
			runIntentBackfillMigration?.statements.some(
				(statement) =>
					normalizeSqlStatement(statement).includes(runProjectionRunIntentStatement) &&
					statement.includes("DEFAULT 'baseline'"),
			),
		).toBe(true);
	});

	it("surfaces composite primary key columns from drizzle snapshots", () => {
		const pageFreshness = latestSpecs.get("official_web.page_freshness");

		expect(pageFreshness?.columns.get("site_id")).toMatchObject({
			name: "site_id",
			primaryKey: true,
		});
		expect(pageFreshness?.columns.get("normalized_canonical_url")).toMatchObject({
			name: "normalized_canonical_url",
			primaryKey: true,
		});
	});

	it("fails closed when an existing app-api-owned table diverges from the repo snapshot", () => {
		const inventory = makeInventory({
			schemas: ["runtime"],
			tables: [
				{
					...buildTableFromExpected("runtime.request_execution"),
					columns: [
						...buildTableFromExpected("runtime.request_execution").columns.filter(
							(column) => column.name !== "trace_id",
						),
					],
				},
			],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(plan.mismatches[0]).toContain("runtime.request_execution");
	});

	it("expects request_execution to carry the durable run backlink", () => {
		const requestExecutionTable = buildTableFromExpected("runtime.request_execution");

		expect(requestExecutionTable.columns).toContainEqual(
			expect.objectContaining({
				name: "run_id",
				notNull: false,
				type: "text",
			}),
		);
	});

	it("treats pending add-column migrations as repairable rather than schema divergence", () => {
		const inventory = makeInventory({
			schemas: ["operator", "runtime"],
			tables: [
				{
					...buildTableFromExpected("runtime.request_execution"),
					columns: buildTableFromExpected("runtime.request_execution").columns.filter(
						(column) => column.name !== "resolved_scope_json",
					),
				},
				{
					...buildTableFromExpected("runtime.request_observability_fact"),
					columns: buildTableFromExpected("runtime.request_observability_fact").columns.filter(
						(column) => column.name !== "resolved_scope_summary",
					),
				},
				{
					...buildTableFromExpected("operator.request_projection"),
					columns: buildTableFromExpected("operator.request_projection").columns.filter(
						(column) => column.name !== "resolved_scope_json",
					),
				},
			],
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(plan.mismatches).toEqual([]);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "runtime.request_execution:resolved_scope_json",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey === "runtime.request_observability_fact:resolved_scope_summary",
			),
		).toBe(true);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "operator.request_projection:resolved_scope_json",
			),
		).toBe(true);
	});

	it("treats retired drop-column migrations as already satisfied once the latest snapshot is present", () => {
		const inventory = makeInventory({
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: [...latestSpecs.keys()].map((qualifiedName) => buildTableFromExpected(qualifiedName)),
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(plan.mismatches).toEqual([]);
		expect(
			plan.statements.some((item) => item.statement.includes('DROP COLUMN "actor_groups_json"')),
		).toBe(false);
		expect(
			plan.statements.some((item) => item.statement.includes('DROP COLUMN "actor_campus_scope"')),
		).toBe(false);
		expect(
			plan.statements.some((item) => item.target.existsKey === "dining.floorplan_assets"),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) => item.target.existsKey === "dining.floors:draft_floorplan_asset_id",
			),
		).toBe(false);
	});

	it("recognizes Postgres-truncated long constraint names as existing constraints", () => {
		const tableNames = [
			"official_web.target_jobs",
			"official_web.target_job_candidates",
			"official_web.target_artifact_verification_summaries",
			"official_web.target_page_attempts",
			"official_web.target_release_gates",
			"official_web.crawl_runs",
		];
		const inventory = makeInventory({
			schemas: ["official_web"],
			tables: tableNames.map((qualifiedName) => {
				const table = buildTableFromExpected(qualifiedName);
				return {
					...table,
					constraints: table.constraints.map((constraint) =>
						constraint ===
						"target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk"
							? "target_release_gates_summary_id_target_artifact_verification_su"
							: constraint,
					),
				};
			}),
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"official_web.target_release_gates#target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk",
			),
		).toBe(false);
		expect(plan.mismatches).not.toContain(
			"official_web.target_release_gates missing constraint target_release_gates_summary_id_target_artifact_verification_summaries_summary_id_fk",
		);
	});

	it("recognizes Postgres-truncated long index names as existing indexes", () => {
		const inventory = makeInventory({
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: [...latestSpecs.keys()].map((qualifiedName) => {
				const table = buildTableFromExpected(qualifiedName);
				if (qualifiedName !== "runtime.request_observability_fact") {
					return table;
				}
				return {
					...table,
					indexes: table.indexes.map((index) =>
						index.name === "runtime_request_observability_selected_capability_started_at_idx"
							? {
									...index,
									name: "runtime_request_observability_selected_capability_started_at_id",
								}
							: index,
					),
				};
			}),
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"runtime.request_observability_fact@runtime_request_observability_selected_capability_started_at_idx",
			),
		).toBe(false);
		expect(plan.mismatches).not.toContain(
			"runtime.request_observability_fact missing index runtime_request_observability_selected_capability_started_at_idx",
		);
	});

	it("does not replay legacy rename source indexes after the renamed target index already exists", () => {
		const inventory = makeInventory({
			schemas: [...new Set([...latestSpecs.values()].map((spec) => spec.schema))],
			tables: [...latestSpecs.keys()].map((qualifiedName) => {
				const table = buildTableFromExpected(qualifiedName);
				if (qualifiedName === "runtime.request_observability_fact") {
					return {
						...table,
						indexes: table.indexes.map((index) =>
							index.name === "runtime_request_observability_selected_capability_started_at_idx"
								? {
										...index,
										name: "runtime_request_observability_selected_capability_started_at_id",
									}
								: index,
						),
					};
				}
				return table;
			}),
		});

		const plan = buildAdoptionPlan({
			inventory,
			migrationContext,
		});

		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"runtime.request_observability_fact@runtime_request_observability_selected_target_started_at_idx",
			),
		).toBe(false);
		expect(
			plan.statements.some(
				(item) =>
					item.target.existsKey ===
					"operator.metric_rollup@operator_metric_rollup_domain_target_bucket_idx",
			),
		).toBe(false);
	});
});
