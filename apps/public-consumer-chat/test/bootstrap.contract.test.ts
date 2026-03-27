// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(import.meta.dirname, "..");

const readAppFile = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("public-consumer-chat bootstrap contracts", () => {
  it("defines repeatable database bootstrap and integration commands", () => {
    const packageJson = JSON.parse(readAppFile("package.json")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["db:bootstrap"]).toBeTruthy();
    expect(packageJson.scripts["db:print-auth-migration"]).toBeTruthy();
    expect(packageJson.scripts["test:integration"]).toBeTruthy();
    expect(packageJson.scripts["smoke:live"]).toContain(
      "../../scripts/public_consumer_chat_live_smoke.py",
    );
  });

  it("checks in explicit bootstrap artifacts instead of relying on runtime auto-create", () => {
    const requiredFiles = [
      "db/migrations/0001_chat_schema.sql",
      "scripts/bootstrap-database.mjs",
      "scripts/print-auth-migration.mjs",
      "test/postgres.integration.test.ts",
    ];

    for (const relativePath of requiredFiles) {
      expect(existsSync(join(appRoot, relativePath)), relativePath).toBe(true);
    }
  });

  it("documents the bootstrap and integration workflow in the README", () => {
    const readme = readAppFile("README.md");
    const envExample = readAppFile(".env.example");

    expect(readme).toContain("pnpm db:bootstrap");
    expect(readme).toContain("pnpm test:integration");
    expect(readme).toContain("PUBLIC_CHAT_TEST_DATABASE_URL");
    expect(readme).toContain("pnpm dev");
    expect(readme).toContain("openssl rand -base64 32");
    expect(readme).toContain("SUPERVISOR_API_BEARER_TOKEN=local-dev-token");
    expect(readme).toContain("API_BEARER_TOKEN=local-dev-token");
    expect(readme).toContain("must match");
    expect(envExample).toContain("BETTER_AUTH_SECRET=<generate-with-openssl-rand-base64-32>");
    expect(envExample).toContain("SUPERVISOR_API_BEARER_TOKEN=local-dev-token");
    expect(envExample).toContain("must match the repo root");
    expect(envExample).not.toContain("BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret");
  });
});
