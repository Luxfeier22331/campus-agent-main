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
const snapshot0000 = migrationContext.snapshots.get("0000_funny_tiger_shark")!;
const snapshotLatest = migrationContext.latestSnapshot;
const latestSpecs = buildExpectedTableSpecs(snapshotLatest);

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
        'ALTER TABLE "official_web"."run_outbox" ADD CONSTRAINT "run_outbox_run_id_crawl_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "official_web"."crawl_runs"("run_id") ON DELETE cascade ON UPDATE no action;',
      ),
    ).toMatchObject({
      existsKey: "official_web.run_outbox#run_outbox_run_id_crawl_runs_run_id_fk",
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
    expect(plan.statements.some((item) => item.target.existsKey === "runtime.request_execution")).toBe(true);
    expect(
      plan.statements.some((item) => item.target.existsKey === "runtime.request_observability_fact"),
    ).toBe(true);
    expect(plan.statements.some((item) => item.target.existsKey === "operator.request_projection")).toBe(true);
    expect(plan.statements.some((item) => item.target.existsKey === "official_web.crawl_runs")).toBe(true);
    expect(plan.journalRowsToInsert.map((item: { tag: string }) => item.tag)).toEqual(
      migrationContext.migrations.map((item) => item.tag),
    );
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
});
