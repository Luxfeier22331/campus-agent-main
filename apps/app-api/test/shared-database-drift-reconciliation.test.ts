// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildExpectedTableSpecs,
  loadMigrationContext,
  makeInventory,
} from "../scripts/adopt-shared-database.mjs";
import { buildSharedDatabaseDriftReconcilePlan } from "../scripts/reconcile-shared-db-drift.mjs";

const migrationContext = loadMigrationContext();
const latestSpecs = buildExpectedTableSpecs(migrationContext.latestSnapshot);

function buildTableFromExpected(qualifiedName: string) {
  const spec = latestSpecs.get(qualifiedName);
  if (!spec) {
    throw new Error(`Missing expected table spec for ${qualifiedName}`);
  }

  return {
    schema: spec.schema,
    table: spec.table,
    columns: [...spec.columns.values()],
    constraints: [...spec.constraints],
    indexes: [...spec.indexes],
  };
}

describe("shared database drift reconciliation", () => {
  it("plans cleanup for the known retired official-web drift shape", () => {
    const inventory = makeInventory({
      journalRows: [
        {
          createdAt: 1774860098469,
          hash: "7813de97d0ef446a8ad044fa9b7ee5cfebc7fd5f00d5985ec9e7037e0b2fc38d",
        },
        {
          createdAt: 1774879434946,
          hash: "75c55b4033592603ded3ff1746e8261b765a5f8ac232234d4520747c314e81ee",
        },
      ],
      schemas: ["official_web", "operator", "runtime"],
      tables: [
        {
          ...buildTableFromExpected("official_web.crawl_runs"),
          columns: [
            ...buildTableFromExpected("official_web.crawl_runs").columns,
            {
              name: "run_intent",
              notNull: true,
              primaryKey: false,
              type: "text",
            },
          ],
        },
        {
          ...buildTableFromExpected("operator.official_web_run_projection"),
          columns: [
            ...buildTableFromExpected("operator.official_web_run_projection").columns,
            {
              name: "run_intent",
              notNull: true,
              primaryKey: false,
              type: "text",
            },
          ],
        },
        buildTableFromExpected("operator.official_web_site_projection"),
        buildTableFromExpected("runtime.request_execution"),
        {
          columns: [
            {
              name: "site_id",
              notNull: true,
              primaryKey: true,
              type: "text",
            },
          ],
          constraints: [],
          indexes: [],
          schema: "official_web",
          table: "page_freshness",
        },
        {
          columns: [
            {
              name: "observation_id",
              notNull: true,
              primaryKey: true,
              type: "text",
            },
          ],
          constraints: [],
          indexes: [],
          schema: "official_web",
          table: "page_observations",
        },
      ],
    });

    const plan = buildSharedDatabaseDriftReconcilePlan({
      extraTableRowCounts: new Map([
        ["official_web.page_freshness", 14],
        ["official_web.page_observations", 22],
      ]),
      inventory,
      migrationContext,
    });

    expect(plan.blockedReasons).toEqual([]);
    expect(plan.extraColumns).toEqual([
      { columnName: "run_intent", qualifiedName: "official_web.crawl_runs" },
      { columnName: "run_intent", qualifiedName: "operator.official_web_run_projection" },
    ]);
    expect(plan.extraTables).toEqual([
      { qualifiedName: "official_web.page_freshness", rowCount: 14 },
      { qualifiedName: "official_web.page_observations", rowCount: 22 },
    ]);
    expect(plan.orphanedJournalRows.map((row: { hash: string }) => row.hash)).toEqual([
      "75c55b4033592603ded3ff1746e8261b765a5f8ac232234d4520747c314e81ee",
    ]);
    expect(plan.operations.map((operation) => operation.kind)).toEqual([
      "drop_table",
      "drop_table",
      "drop_column",
      "drop_index",
      "drop_column",
      "create_index",
      "delete_journal_row",
    ]);
    expect(plan.nonEmptyDriftTables).toEqual([
      { qualifiedName: "official_web.page_freshness", rowCount: 14 },
      { qualifiedName: "official_web.page_observations", rowCount: 22 },
    ]);
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
    expect(plan.operations.map((operation) => operation.kind)).toEqual(["drop_column", "drop_column"]);
  });
});
