// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAppApiGrantSql } from "../ops/db/app-api-grants.ts";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function readAppFile(relativePath: string): string {
	return readFileSync(resolve(appRoot, relativePath), "utf8");
}

describe("app-api schema installer", () => {
	it("grants the runtime role only app-api-owned database surfaces", () => {
		const sql = buildAppApiGrantSql();

		expect(sql).toContain('GRANT USAGE ON SCHEMA "app_auth"');
		expect(sql).toContain('"chat"');
		expect(sql).toContain('"observability"');
		expect(sql).toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "runtime"."request_observability_fact"',
		);
		expect(sql).toContain('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "runtime"');
		expect(sql).not.toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "runtime"',
		);
		expect(sql).not.toContain('"runtime"."agent_runs"');
	});

	it("uses an immutable migration ledger before current auth and chat bootstrap", () => {
		const source = readAppFile("ops/db/schema.ts");
		const journal = readAppFile("drizzle/meta/_journal.json");

		expect(source).toContain("await migrate(");
		expect(source).toContain('migrationsSchema: "drizzle"');
		expect(source).toContain('migrationsTable: "app_api_migrations"');
		expect(source).toContain("bootstrapSharedProductDatabase");
		expect(source).toContain("applyAppApiGrants");
		expect(source).toContain("applyOpsWebGrantStatements");
		expect(journal).toContain('"tag": "0000_initial"');
		expect(readAppFile("drizzle/0000_initial.sql")).toContain(
			'CREATE TABLE "runtime"."request_observability_fact"',
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
