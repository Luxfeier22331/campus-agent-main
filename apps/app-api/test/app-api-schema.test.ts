// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
		expect(source).not.toContain("prepareSharedProductSchemas");
		expect(source).toContain("applyAppApiGrants");
		expect(source).not.toContain("applyOpsWebGrantStatements");
		expect(source).toContain("console.error(error)");
		expect(source).not.toContain("error instanceof Error ? error.message");
		const expectedEntries = [
			{ idx: 0, tag: "0000_initial", version: "7" },
			{ idx: 1, tag: "0001_docs_release_scope", version: "7" },
			{ idx: 2, tag: "0002_provider_config_handoff", version: "7" },
			{ idx: 3, tag: "0003_hindsight_productionization", version: "7" },
			{ idx: 4, tag: "0004_campus_groups", version: "7" },
			{ idx: 5, tag: "0005_campus_groups_seed", version: "7" },
			{ idx: 6, tag: "0006_auth_ownership_and_account_lifecycle", version: "7" },
			{ idx: 7, tag: "0007_execution_runtime_ownership", version: "7" },
			{ idx: 8, tag: "0008_retain_execution_input", version: "7" },
		];
		expect(journal.entries.map(({ idx, tag, version }) => ({ idx, tag, version }))).toEqual(
			expectedEntries,
		);
		const migrationFiles = readdirSync(resolve(appRoot, "drizzle"))
			.filter((file) => /^\d{4}_.+\.sql$/u.test(file))
			.sort();
		const snapshotFiles = readdirSync(resolve(appRoot, "drizzle/meta"))
			.filter((file) => /^\d{4}_snapshot\.json$/u.test(file))
			.sort();
		expect(migrationFiles).toEqual(expectedEntries.map(({ tag }) => `${tag}.sql`));
		expect(snapshotFiles).toEqual(
			expectedEntries.map(({ idx }) => `${String(idx).padStart(4, "0")}_snapshot.json`),
		);
		let previousSnapshotId = "00000000-0000-0000-0000-000000000000";
		for (const snapshotFile of snapshotFiles) {
			const snapshot = JSON.parse(readAppFile(`drizzle/meta/${snapshotFile}`)) as {
				id: string;
				prevId: string;
			};
			expect(snapshot.prevId, snapshotFile).toBe(previousSnapshotId);
			previousSnapshotId = snapshot.id;
		}
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE TABLE IF NOT EXISTS "app_auth"."user"',
		);
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE TABLE "app_auth"."email_access_grant"',
		);
		expect(readAppFile("drizzle/0006_auth_ownership_and_account_lifecycle.sql")).toContain(
			'CREATE INDEX IF NOT EXISTS "user_created_at_id_idx"',
		);
		expect(readAppFile("drizzle/0007_execution_runtime_ownership.sql")).toContain(
			'ALTER TABLE "runtime"."request_observability_fact" DROP COLUMN IF EXISTS "requested_tool"',
		);
		const retainExecutionInputMigration = readAppFile("drizzle/0008_retain_execution_input.sql");
		expect(retainExecutionInputMigration).toContain(
			'DROP COLUMN IF EXISTS "execution_input_released_at"',
		);
		expect(retainExecutionInputMigration).not.toContain('dispatch."execution_input_released_at"');
		expect(retainExecutionInputMigration).toContain(
			'ALTER TABLE "chat"."conversations" DROP COLUMN "context_summary"',
		);
		const initialMigration = readAppFile("drizzle/0000_initial.sql");
		expect(initialMigration).not.toContain('CREATE SCHEMA IF NOT EXISTS "chat"');
		expect(readAppFile("drizzle/baseline/chat_pre_0001.sql")).toContain(
			'CREATE TABLE IF NOT EXISTS "chat"."turn_dispatches"',
		);
		expect(initialMigration).toContain('CREATE TABLE "runtime"."request_observability_fact"');
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

	it("uses Drizzle as the only app-api schema migration source", () => {
		const config = readAppFile("drizzle.config.ts");
		const managedSchema = readAppFile("src/db/schema/managed.ts");

		expect(config).toContain('schema: "./src/db/schema/managed.ts"');
		expect(managedSchema).toContain('export * from "./chat"');
		expect(existsSync(resolve(appRoot, "db/shared-product-schema/chat_current.sql"))).toBe(false);
		expect(existsSync(resolve(appRoot, "drizzle/baseline/chat_pre_0001.sql"))).toBe(true);
		expect(existsSync(resolve(appRoot, "test/fixtures/chat-pre-0001.sql"))).toBe(false);
		expect(existsSync(resolve(appRoot, "src/db/schema/owned.ts"))).toBe(false);
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
