// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateNotices } from "../src/migrate.ts";

const POSTGRES_IMAGE =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const jobRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("notice schema migration", () => {
	let container: StartedPostgreSqlContainer;
	let pool: Pool;

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withDatabase("campus_agent_notice_test")
			.withUsername("migration_test")
			.withPassword(randomUUID())
			.withResourcesQuota({ cpu: 1, memory: 384 * 1024 * 1024 })
			.start();
		pool = new Pool({ connectionString: container.getConnectionUri() });
		await pool.query("CREATE ROLE campus_agent NOLOGIN");
		await pool.query("CREATE ROLE notice_publisher NOLOGIN");
		await pool.query("CREATE ROLE app_api NOLOGIN");
	}, 120_000);

	beforeEach(async () => {
		await pool.query("DROP SCHEMA IF EXISTS notices CASCADE");
	});

	afterAll(async () => {
		try {
			await pool?.end();
		} finally {
			await container?.stop();
		}
	}, 60_000);

	it("installs an empty database and grants only business-table reads to app_api", async () => {
		await withClient(pool, async (client) => {
			await expect(migrateNotices(client)).resolves.toBe("applied");
			await expect(readVersions(client)).resolves.toEqual([1, 2, 3, 4]);
			await assertAppApiReadOnly(client);
		});
	});

	it("upgrades a v1 database and is current when repeated", async () => {
		await withClient(pool, async (client) => {
			await client.query(await readFile(resolve(jobRoot, "migrations/0001_notices.sql"), "utf8"));
			await expect(migrateNotices(client)).resolves.toBe("applied");
			await expect(readVersions(client)).resolves.toEqual([1, 2, 3, 4]);
			await expect(migrateNotices(client)).resolves.toBe("current");
			await assertAppApiReadOnly(client);
		});
	});

	it("adds the source attachment identifier column", async () => {
		await withClient(pool, async (client) => {
			await expect(migrateNotices(client)).resolves.toBe("applied");
			await expect(
				client.query(
					"SELECT data_type FROM information_schema.columns WHERE table_schema='notices' AND table_name='notice_assets' AND column_name='portal_annex_id'",
				),
			).resolves.toMatchObject({ rows: [{ data_type: "text" }] });
		});
	});

	it("removes stored external wrapper content and enforces the normalized contract", async () => {
		await withClient(pool, async (client) => {
			await client.query(await readFile(resolve(jobRoot, "migrations/0001_notices.sql"), "utf8"));
			await client.query(
				await readFile(resolve(jobRoot, "migrations/0002_app_api_notice_read.sql"), "utf8"),
			);
			await client.query(`
				INSERT INTO notices.notice_types(notice_type, name) VALUES (5, '办公通知');
				INSERT INTO notices.notices(
					notice_id, notice_type, organization_id, title, released_at,
					is_external, external_url, domain, content_html, content_text
				) VALUES (
					1, 5, NULL, '外链通知', now(), true, 'https://example.edu/notice',
					'campus_news', '<p>门户摘要</p>', '门户摘要'
				);
			`);

			await expect(migrateNotices(client)).resolves.toBe("applied");
			await expect(
				client.query(
					"SELECT content_html, content_text FROM notices.notices WHERE notice_id = 1",
				),
			).resolves.toMatchObject({ rows: [{ content_html: null, content_text: null }] });
			await expect(
				client.query(
					"UPDATE notices.notices SET content_html = '<p>摘要</p>' WHERE notice_id = 1",
				),
			).rejects.toThrow(/notices_external_content_check/u);
		});
	});

	it("rejects an unknown migration ledger without changing it", async () => {
		await withClient(pool, async (client) => {
			await expect(migrateNotices(client)).resolves.toBe("applied");
			await client.query("INSERT INTO notices.schema_migrations(version) VALUES (99)");
			await expect(migrateNotices(client)).rejects.toThrow(
				"notices schema migration state is unsupported",
			);
			await expect(readVersions(client)).resolves.toEqual([1, 2, 3, 4, 99]);
		});
	});

	it("rejects a partial notices schema", async () => {
		await withClient(pool, async (client) => {
			await client.query(`
				CREATE SCHEMA notices AUTHORIZATION campus_agent;
				CREATE TABLE notices.schema_migrations(version integer PRIMARY KEY);
				INSERT INTO notices.schema_migrations(version) VALUES (1);
			`);
			await expect(migrateNotices(client)).rejects.toThrow(
				"notices schema migration state is unsupported",
			);
		});
	});
});

async function assertAppApiReadOnly(client: PoolClient): Promise<void> {
	await client.query("SET ROLE app_api");
	try {
		for (const table of [
			"notice_types",
			"organizations",
			"domains",
			"notices",
			"notice_assets",
		]) {
			await expect(client.query(`SELECT * FROM notices.${table} LIMIT 0`)).resolves.toBeDefined();
		}
		await expect(client.query("SELECT * FROM notices.schema_migrations LIMIT 0")).rejects.toThrow(
			/permission denied/u,
		);
		await expect(
			client.query("INSERT INTO notices.domains(domain) VALUES ('blocked')"),
		).rejects.toThrow(/permission denied/u);
	} finally {
		await client.query("RESET ROLE");
	}
}

async function readVersions(client: PoolClient): Promise<number[]> {
	const result = await client.query<{ version: number }>(
		"SELECT version FROM notices.schema_migrations ORDER BY version",
	);
	return result.rows.map((row) => row.version);
}

async function withClient<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await pool.connect();
	try {
		return await operation(client);
	} finally {
		client.release();
	}
}
