// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAppApiGrantSql } from "../ops/db/app-api-grants.ts";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");

function readAppFile(relativePath: string): string {
	return readFileSync(resolve(appRoot, relativePath), "utf8");
}

function appFileSha256(relativePath: string): string {
	return createHash("sha256")
		.update(readFileSync(resolve(appRoot, relativePath)))
		.digest("hex");
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
		expect(sql).not.toContain('"official_web"');
		expect(sql).not.toContain('"operator"');
		expect(sql).not.toContain('"wechat_official_account"');
	});

	it("bootstraps current auth and chat before applying the immutable migration ledger", () => {
		const source = readAppFile("ops/db/schema.ts");
		const journal = readAppFile("drizzle/meta/_journal.json");

		expect(source).toContain("await migrate(");
		expect(source).toContain('migrationsSchema: "drizzle"');
		expect(source).toContain('migrationsTable: "app_api_migrations"');
		expect(source).toContain("bootstrapSharedProductDatabase");
		expect(source.indexOf("bootstrapSharedProductDatabase(bootstrapEnv)")).toBeLessThan(
			source.indexOf("await migrate("),
		);
		expect(source).toContain("applyAppApiGrants");
		expect(source).toContain("applyOpsWebGrantStatements");
		expect(journal).toContain('"tag": "0000_initial"');
		expect(journal).toContain('"tag": "0001_runtime_cleanup"');
		expect(appFileSha256("drizzle/0000_initial.sql")).toBe(
			"1dacf105c0d166a87db3fd5d6dbef48cfb10cf1e2261ad082c2c7e9b63c03b65",
		);
		expect(appFileSha256("drizzle/meta/0000_snapshot.json")).toBe(
			"4f524d5752e82deb4372bcc5eb0070d102addac2cae26d7d3cb5fd11087c140a",
		);
		expect(JSON.parse(journal).entries[0]).toEqual({
			breakpoints: true,
			idx: 0,
			tag: "0000_initial",
			version: "7",
			when: 1783899714209,
		});
		expect(readAppFile("drizzle/0000_initial.sql")).toContain(
			'CREATE TABLE "runtime"."request_observability_fact"',
		);
		const cleanup = readAppFile("drizzle/0001_runtime_cleanup.sql");
		expect(cleanup).toContain(
			'ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "resolved_targets_json"',
		);
		expect(cleanup).toContain(
			'ALTER TABLE "runtime"."request_observability_fact" ADD COLUMN "resolved_targets_json"',
		);
		for (const schema of ["official_web", "operator", "wechat_official_account"]) {
			expect(cleanup).toContain(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		}
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
