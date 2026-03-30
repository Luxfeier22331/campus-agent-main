// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "..");

function readAppFile(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("app-api shared product bootstrap contracts", () => {
  it("defines repeatable bootstrap and test lane commands for app_auth/chat ownership", () => {
    const packageJson = JSON.parse(readAppFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["db:bootstrap"]).toBeTruthy();
    expect(packageJson.scripts["db:ensure-app-auth-role-search-path"]).toBeTruthy();
    expect(packageJson.scripts["db:print-auth-migration"]).toBeTruthy();
    expect(packageJson.scripts["db:reconcile-shared-drift"]).toContain(
      "reconcile-shared-db-drift.mjs",
    );
    expect(packageJson.scripts["test"]).toBe("pnpm run test:node");
    expect(packageJson.scripts["test:all"]).toContain("vitest.config.mts");
    expect(packageJson.scripts["test:node"]).toContain("vitest.node.config.mts");
    expect(packageJson.scripts["test:worker"]).toContain("vitest.worker.config.mts");
    expect(packageJson.scripts["test:shared-db-integration"]).toContain(
      "vitest.shared-db.config.mts",
    );
  });

  it("checks in explicit shared product bootstrap artifacts under app-api", () => {
    const requiredFiles = [
      "db/shared-product-migrations/0001_chat_schema.sql",
      "db/shared-product-migrations/0002_message_retryable.sql",
      "scripts/bootstrap-shared-product-database.mjs",
      "scripts/ensure-app-auth-role-search-path.mjs",
      "scripts/print-shared-product-auth-migration.mjs",
      "scripts/reconcile-shared-db-drift.mjs",
      "scripts/shared-product-database-bootstrap.mjs",
      "scripts/shared-product-database-bootstrap.d.mts",
      "vitest.worker.config.mts",
      "vitest.shared-db.config.mts",
      "test/shared-product-db.integration.test.ts",
    ];

    for (const relativePath of requiredFiles) {
      expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
    }
  });

  it("documents app-api as the shared product DB bootstrap owner", () => {
    const readme = readAppFile("README.md");

    expect(readme).toContain("db:bootstrap");
    expect(readme).toContain("db:ensure-app-auth-role-search-path");
    expect(readme).toContain("db:reconcile-shared-drift");
    expect(readme).toContain("test:node");
    expect(readme).toContain("test:worker");
    expect(readme).toContain("test:shared-db-integration");
    expect(readme).toContain("app_auth.*");
    expect(readme).toContain("chat.*");
  });
});
