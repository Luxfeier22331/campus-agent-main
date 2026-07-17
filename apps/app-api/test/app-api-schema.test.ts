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
		expect(sql).not.toContain('"observability"');
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

	it("extends the immutable main migration ledger with one productionization migration", () => {
		const source = readAppFile("ops/db/schema.ts");
		const journalSource = readAppFile("drizzle/meta/_journal.json");
		const journal = JSON.parse(journalSource) as {
			entries: Array<{
				breakpoints: boolean;
				idx: number;
				tag: string;
				version: string;
				when: number;
			}>;
		};

		expect(source).toContain("await migrate(");
		expect(source).toContain('migrationsSchema: "drizzle"');
		expect(source).toContain('migrationsTable: "app_api_migrations"');
		expect(source).toContain("bootstrapSharedProductDatabase");
		expect(source.indexOf("bootstrapSharedProductDatabase(bootstrapEnv)")).toBeLessThan(
			source.indexOf("await migrate("),
		);
		expect(source).toContain("applyAppApiGrants");
		expect(source).not.toContain("applyOpsWebGrantStatements");
		expect(journal.entries.map(({ idx, tag, version }) => ({ idx, tag, version }))).toEqual([
			{ idx: 0, tag: "0000_initial", version: "7" },
			{ idx: 1, tag: "0001_docs_release_scope", version: "7" },
			{ idx: 2, tag: "0002_provider_config_handoff", version: "7" },
			{ idx: 3, tag: "0003_hindsight_productionization", version: "7" },
		]);
		expect(appFileSha256("drizzle/0000_initial.sql")).toBe(
			"3c2464d91d240212435818779898cf68fe72e59077b8833b4bfed023686cd0df",
		);
		expect(appFileSha256("drizzle/meta/0000_snapshot.json")).toBe(
			"fd859daff27fa64bd7ec2c78438bb0e3b2343a71d6bae8578473f4a00a4621f5",
		);
		expect(journal.entries[0]).toEqual({
			breakpoints: true,
			idx: 0,
			tag: "0000_initial",
			version: "7",
			when: 1784181304800,
		});
		expect(readAppFile("drizzle/0000_initial.sql")).toContain(
			'CREATE TABLE "runtime"."request_observability_fact"',
		);
		const productionization = readAppFile("drizzle/0003_hindsight_productionization.sql");
		expect(productionization).toContain(
			'ALTER TABLE "chat"."turn_dispatches" ADD COLUMN IF NOT EXISTS "admission_status"',
		);
		expect(productionization).toContain('CREATE TABLE "profile"."memory_commands"');
		expect(productionization).toContain('"supersession_scope" text NOT NULL');
		expect(productionization).toContain('"accepted_lifecycle_state" text NOT NULL');
		expect(productionization).toContain(
			"WHEN \"profile_memory_enabled\" THEN 'active'\n\tELSE 'paused'",
		);
		for (const schema of [
			"campus_services_ops",
			"identity",
			"observability",
			"official_web",
			"operator",
			"provider_config",
			"wechat_official_account",
		]) {
			expect(productionization).toContain(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
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
