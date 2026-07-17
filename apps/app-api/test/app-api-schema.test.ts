// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAppApiGrantSql } from "../ops/db/app-api-grants.ts";
import { resolveLocalSchemaAction } from "../ops/db/prepare-local.ts";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function readAppFile(relativePath: string): string {
	return readFileSync(resolve(appRoot, relativePath), "utf8");
}

describe("app-api schema installer", () => {
	it("admits only empty or complete app-api local schema states", () => {
		expect(resolveLocalSchemaAction({ presentTables: [] })).toBe("install");
		expect(
			resolveLocalSchemaAction({
				presentTables: ["app_auth.user", "chat.turn_dispatches"],
			}),
		).toBe("existing");
		expect(() =>
			resolveLocalSchemaAction({
				presentTables: ["app_auth.user"],
			}),
		).toThrow("Local app-api schema is incomplete");
	});

	it("prepares local PostgreSQL and deterministic dining data before web development", () => {
		const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		const prepareSource = readFileSync(resolve(repoRoot, "scripts/dev/prepare.ts"), "utf8");
		const localSchemaSource = readAppFile("ops/db/prepare-local.ts");
		const envLoaderSource = readAppFile("scripts/run-with-local-env.ts");

		expect(rootPackage.scripts.predev).toBe("pnpm dev:prepare");
		expect(rootPackage.scripts["dev:prepare"]).toContain("scripts/dev/prepare.ts");
		expect(prepareSource).toContain("docker-compose.postgres.yml");
		expect(prepareSource).toContain("prepare-local.ts");
		expect(prepareSource).toContain('"migrate-local"');
		expect(prepareSource).toContain("import-dev-seed");
		expect(localSchemaSource).toContain("migrationsFolder");
		expect(localSchemaSource).toContain("bootstrapSharedProductDatabase");
		expect(envLoaderSource).toContain("--git-common-dir");
		expect(envLoaderSource).toContain("applyLocalDatabaseDefaults");
	});

	it("grants the runtime role only app-api-owned database surfaces", () => {
		const sql = buildAppApiGrantSql();

		expect(sql).toContain('GRANT USAGE ON SCHEMA "app_auth"');
		expect(sql).toContain('"chat"');
		expect(sql).toContain('"observability"');
		expect(sql).toContain('GRANT SELECT ON ALL TABLES IN SCHEMA "docs" TO "app_api"');
		expect(sql).not.toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "docs" TO "app_api"',
		);
		expect(sql).toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "docs" TO "docs_publish"',
		);
		expect(sql).toContain('REVOKE ALL PRIVILEGES ON SCHEMA "provider_config" FROM "app_api"');
		expect(sql).toContain(
			'GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "provider_config" TO "ops_web_provider_config"',
		);
		expect(sql).toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "runtime"."request_observability_fact"',
		);
		expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "runtime"');
		expect(sql).not.toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "runtime"',
		);
		expect(sql).not.toContain('"runtime"."agent_runs"');
		expect(sql).not.toContain('SCHEMA "dining"');
		expect(sql).not.toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "dining"',
		);
		expect(sql).not.toContain('"official_web"');
		expect(sql).not.toContain('"operator"');
		expect(sql).not.toContain('"wechat_official_account"');
	});

	it("keeps one app-api-owned migration ledger without Dining control-plane tables", () => {
		const source = readAppFile("ops/db/schema.ts");
		const journal = JSON.parse(readAppFile("drizzle/meta/_journal.json")) as {
			entries: Array<{ idx: number; tag: string; version: string }>;
		};

		expect(source).toContain("await migrate(");
		expect(source).toContain('migrationsSchema: "drizzle"');
		expect(source).toContain('migrationsTable: "app_api_migrations"');
		expect(source).toContain("bootstrapSharedProductDatabase");
		expect(source).toContain("applyAppApiGrants");
		expect(source).toContain("applyOpsWebGrantStatements");
		expect(journal.entries.map(({ idx, tag, version }) => ({ idx, tag, version }))).toEqual([
			{ idx: 0, tag: "0000_initial", version: "7" },
			{ idx: 1, tag: "0001_docs_release_scope", version: "7" },
			{ idx: 2, tag: "0002_provider_config_handoff", version: "7" },
		]);
		const sql = readAppFile("drizzle/0000_initial.sql");
		expect(sql).toContain('CREATE TABLE "runtime"."request_observability_fact"');
		expect(sql).not.toContain('CREATE SCHEMA "dining"');
		expect(sql).not.toContain('CREATE TABLE "dining".');
		const docsReleaseScopeSql = readAppFile("drizzle/0001_docs_release_scope.sql");
		expect(docsReleaseScopeSql).toContain('DROP SCHEMA IF EXISTS "docs" CASCADE');
		expect(docsReleaseScopeSql).toContain('CREATE TABLE "docs"."releases"');
		expect(docsReleaseScopeSql).toContain('"release_id" text NOT NULL');
		const providerHandoffSql = readAppFile("drizzle/0002_provider_config_handoff.sql");
		expect(providerHandoffSql).toContain(
			'ALTER TABLE "provider_config"."profiles" DROP COLUMN "active"',
		);
		expect(providerHandoffSql).toContain(
			'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "provider_config" FROM "app_api"',
		);
	});

	it("keeps campus-services schema installation with its publisher owner", () => {
		const bootstrap = readAppFile(
			"src/script-support/shared-db/shared-product-database-bootstrap.ts",
		);

		expect(bootstrap).toContain('"chat_current.sql"');
		expect(bootstrap).not.toContain("readdir(sharedProductSchemaRoot");
		expect(bootstrap).not.toContain('"campus_services.sql"');
	});

	it("packages only the app-api schema entrypoint into the migration image", () => {
		const dockerfile = readFileSync(resolve(repoRoot, "jobs/app-api-schema/Dockerfile"), "utf8");
		const packageManifest = JSON.parse(
			readFileSync(resolve(repoRoot, "jobs/app-api-schema/package.json"), "utf8"),
		) as { dependencies: Record<string, string> };

		expect(dockerfile).toContain("ops/db/schema.ts");
		expect(dockerfile).toContain("--prod --no-optional");
		expect(dockerfile).toContain("USER node");
		expect(dockerfile).not.toContain("wrangler");
		expect(Object.keys(packageManifest.dependencies).sort()).toEqual([
			"@better-auth/oauth-provider",
			"better-auth",
			"drizzle-orm",
			"pg",
		]);
	});
});
