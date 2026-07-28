// @vitest-environment node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAppApiGrantSql } from "../ops/db/app-api-grants.ts";
import { buildCampusServicesGrantSql } from "../ops/db/campus-services-grants.ts";

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
		const sql = buildAppApiGrantSql("campus_agent_wt_3_a1b2c3d4");

		expect(sql).toContain('GRANT USAGE ON SCHEMA "app_auth"');
		expect(sql).toContain('"chat"');
		expect(sql).toContain(
			'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "campus_groups" TO "app_api"',
		);
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
		expect(sql).not.toContain('"dining"');
		expect(sql).not.toContain('"wechat_official_account"');
		expect(sql).toContain('GRANT CONNECT ON DATABASE "campus_agent_wt_3_a1b2c3d4"');
		expect(() => buildAppApiGrantSql("campus-agent-invalid")).toThrow(
			"database name must be a lowercase PostgreSQL identifier",
		);
	});

	it("keeps the immutable main migration ledger aligned with app-owned schema changes", () => {
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
		expect(source).toContain("prepareSharedProductSchemas");
		expect(source.indexOf("prepareSharedProductSchemas(envOverrides)")).toBeLessThan(
			source.indexOf("await migrate("),
		);
		expect(source).toContain("applyAppApiGrants");
		expect(source).not.toContain("applyOpsWebGrantStatements");
		expect(journal.entries.map(({ idx, tag, version }) => ({ idx, tag, version }))).toEqual([
			{ idx: 0, tag: "0000_initial", version: "7" },
			{ idx: 1, tag: "0001_docs_release_scope", version: "7" },
			{ idx: 2, tag: "0002_provider_config_handoff", version: "7" },
			{ idx: 3, tag: "0003_hindsight_productionization", version: "7" },
			{ idx: 4, tag: "0004_campus_groups", version: "7" },
			{ idx: 5, tag: "0005_campus_groups_seed", version: "7" },
			{ idx: 6, tag: "0006_auth_ownership_and_account_lifecycle", version: "7" },
		]);
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE TABLE IF NOT EXISTS "app_auth"."user"',
		);
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE TABLE "app_auth"."email_access_grant"',
		);
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE INDEX IF NOT EXISTS "user_created_at_id_idx"',
		);
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

	it("grants each campus-services reader only its consumed tables", () => {
		const sql = buildCampusServicesGrantSql();

		expect(sql).toContain('REVOKE ALL ON SCHEMA "campus_services" FROM PUBLIC');
		expect(sql).toContain(
			'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "campus_services" FROM "app_api", "execution_control"',
		);
		expect(sql).toContain(
			'"campus_services"."transport_releases",\n  "campus_services"."transport_current"\nTO "app_api"',
		);
		expect(sql).toContain('"campus_services"."transport_routes"');
		expect(sql).toContain('"campus_services"."transport_departures"');
		expect(sql).toContain('TO "execution_control"');
		expect(sql).not.toContain("GRANT INSERT");
		expect(sql).not.toContain("GRANT UPDATE");
		expect(sql).not.toContain("GRANT DELETE");
		expect(sql).toContain("$retire_campus_services_ops_web$");
		expect(sql).not.toContain("campus_services_publisher");
		expect(sql).toContain("rolname = 'ops_web'");
	});

	it("installs every current shared-product schema through app-api-schema", () => {
		const bootstrap = readAppFile(
			"src/script-support/shared-db/shared-product-database-bootstrap.ts",
		);

		expect(bootstrap).toContain('"chat_current.sql"');
		expect(bootstrap).not.toContain("readdir(sharedProductSchemaRoot");
		expect(bootstrap).toContain('"campus_services.sql"');
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
		expect(Object.keys(packageManifest.dependencies).sort()).toEqual(["drizzle-orm", "pg"]);
	});
});
