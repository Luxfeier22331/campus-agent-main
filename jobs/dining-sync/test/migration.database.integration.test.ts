// @vitest-environment node

import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrateDining } from "../src/migrate.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";

describe("dining migration", () => {
	let container: StartedPostgreSqlContainer;
	let databaseUrl = "";

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase("campus_agent_dining_test")
			.withUsername("migration_test")
			.withPassword(randomUUID())
			.withResourcesQuota({ cpu: 1, memory: 512 * 1024 * 1024 })
			.start();
		databaseUrl = container.getConnectionUri();
	}, 180_000);

	afterAll(async () => {
		if (container) {
			await container.stop();
		}
	}, 60_000);

	beforeEach(async () => {
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			await client.query("DROP EVENT TRIGGER IF EXISTS fail_dining_migration");
			await client.query("DROP FUNCTION IF EXISTS public.fail_dining_migration() CASCADE");
			await client.query("DROP SCHEMA IF EXISTS dining CASCADE");
			await client.query("DROP TABLE IF EXISTS public.dining_migrations");
		} finally {
			await client.end();
		}
	});

	it("is idempotent and preserves existing data", async () => {
		await migrateDining(databaseUrl);
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			await client.query(
				`INSERT INTO dining.halls(hall_id, campus, name, created_at, updated_at)
				 VALUES ('hall:test', 'haidian', 'Test hall', now(), now())`,
			);
		} finally {
			await client.end();
		}

		await migrateDining(databaseUrl);
		const verification = new Client({ connectionString: databaseUrl });
		await verification.connect();
		try {
			const halls = await verification.query("SELECT hall_id FROM dining.halls");
			const journal = await verification.query(
				"SELECT migration_id, sha256 FROM public.dining_migrations",
			);
			expect(halls.rows).toEqual([{ hall_id: "hall:test" }]);
			expect(journal.rows).toHaveLength(1);
			expect(journal.rows[0]).toMatchObject({ migration_id: "0001_dining" });
			expect(String(journal.rows[0]?.sha256)).toMatch(/^[0-9a-f]{64}$/u);
		} finally {
			await verification.end();
		}
	});

	it("does not publish a journal entry when the schema transaction fails", async () => {
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			await client.query(`CREATE TABLE public.dining_migrations (
				migration_id text PRIMARY KEY,
				sha256 text NOT NULL,
				applied_at timestamptz NOT NULL DEFAULT now()
			)`);
			await client.query(`CREATE FUNCTION public.fail_dining_migration()
				RETURNS event_trigger LANGUAGE plpgsql AS $$
				BEGIN
					IF tg_tag = 'CREATE TABLE' THEN
						RAISE EXCEPTION 'injected dining migration failure';
					END IF;
				END
				$$`);
			await client.query(
				"CREATE EVENT TRIGGER fail_dining_migration ON ddl_command_start EXECUTE FUNCTION public.fail_dining_migration()",
			);
		} finally {
			await client.end();
		}

		await expect(migrateDining(databaseUrl)).rejects.toThrow(/injected dining migration failure/);

		const verification = new Client({ connectionString: databaseUrl });
		await verification.connect();
		try {
			await verification.query("DROP EVENT TRIGGER fail_dining_migration");
			const journal = await verification.query("SELECT migration_id FROM public.dining_migrations");
			const schema = await verification.query(
				"SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'dining'",
			);
			expect(journal.rows).toEqual([]);
			expect(schema.rows).toEqual([]);
		} finally {
			await verification.end();
		}
	});
});
