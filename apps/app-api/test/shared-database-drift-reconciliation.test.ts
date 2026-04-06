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
    indexes: [...spec.indexes.values()],
  };
}

describe("shared database drift reconciliation", () => {
  it("plans cleanup for the known retired official-web orphaned journal shape", () => {
    const inventory = makeInventory({
      journalRows: [
        {
          createdAt: 1774860098469,
          hash: "7813de97d0ef446a8ad044fa9b7ee5cfebc7fd5f00d5985ec9e7037e0b2fc38d",
        },
        {
          createdAt: 1774879434946,
          hash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
      ],
      schemas: ["official_web", "operator", "runtime"],
      tables: [
        {
          ...buildTableFromExpected("official_web.crawl_runs"),
          columns: [
            ...buildTableFromExpected("official_web.crawl_runs").columns,
          ],
        },
        {
          ...buildTableFromExpected("operator.official_web_run_projection"),
          columns: [
            ...buildTableFromExpected("operator.official_web_run_projection").columns,
          ],
        },
        buildTableFromExpected("operator.official_web_site_projection"),
        buildTableFromExpected("runtime.request_execution"),
        buildTableFromExpected("official_web.page_freshness"),
        buildTableFromExpected("official_web.page_observations"),
      ],
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
    expect(plan.operations.map((operation) => operation.kind)).toEqual(["drop_column", "drop_column"]);
  });
});
