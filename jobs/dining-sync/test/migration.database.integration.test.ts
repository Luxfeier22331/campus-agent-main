// @vitest-environment node

import { randomUUID } from "node:crypto";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyDiningDatabaseGrants, type DiningDatabaseRole } from "../src/database-grants.ts";
import { installDiningDatabase, migrateDining } from "../src/migrate.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DINING_ROLES = ["app_api", "dining_sync", "ops_web_dining"] as const;

describe("Dining database installation", () => {
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
			await client.query("DROP SCHEMA IF EXISTS dining CASCADE");
			await client.query("DROP SCHEMA IF EXISTS dining_migrations CASCADE");
			for (const role of DINING_ROLES) {
				await client.query(`DROP ROLE IF EXISTS "${role}"`);
			}
		} finally {
			await client.end();
		}
	});

	it("installs once with Drizzle, preserves data, and reapplies grants", async () => {
		await createRoles(DINING_ROLES);
		await expect(installDiningDatabase(databaseUrl)).resolves.toEqual({
			roles: [...DINING_ROLES],
			status: "ready",
		});

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

		await expect(installDiningDatabase(databaseUrl)).resolves.toEqual({
			roles: [...DINING_ROLES],
			status: "ready",
		});
		const verification = new Client({ connectionString: databaseUrl });
		await verification.connect();
		try {
			const halls = await verification.query("SELECT hall_id FROM dining.halls");
			const journal = await verification.query(
				"SELECT id, hash, created_at FROM dining_migrations.history",
			);
			expect(halls.rows).toEqual([{ hall_id: "hall:test" }]);
			expect(journal.rows).toHaveLength(1);
			expect(journal.rows[0]).toMatchObject({ id: 1 });
			expect(String(journal.rows[0]?.hash)).toMatch(/^[0-9a-f]{64}$/u);
			expect(Number(journal.rows[0]?.created_at)).toBeGreaterThan(0);
		} finally {
			await verification.end();
		}
	});

	it("enforces publication and active recheck constraints", async () => {
		await migrateDining(databaseUrl);
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			expect(
				await queryErrorCode(
					client,
					`INSERT INTO dining.reviews(
						review_id, source_record_id, source_hash, campus, hall_name, stall_name,
						dish_name, submitted_at, moderation_status, visibility, created_at, updated_at
					 ) VALUES (
						'review:published', 'record:published', 'sha256:test', 'haidian', 'Hall',
						'Stall', 'Dish', now(), 'safe', 'published', now(), now()
					 )`,
				),
			).toBe("23514");

			await client.query(
				`INSERT INTO dining.reviews(
					review_id, source_record_id, source_hash, campus, hall_name, stall_name,
					dish_name, submitted_at, moderation_status, visibility, created_at, updated_at
				 ) VALUES (
					'review:hidden', 'record:hidden', 'sha256:test', 'haidian', 'Hall',
					'Stall', 'Dish', now(), 'uncertain', 'hidden', now(), now()
				 )`,
			);
			await client.query(
				`INSERT INTO dining.review_recheck_requests(
					request_id, review_id, status, available_at, requested_at, requested_by
				 ) VALUES ('recheck:1', 'review:hidden', 'pending', now(), now(), 'test')`,
			);
			expect(
				await queryErrorCode(
					client,
					`INSERT INTO dining.review_recheck_requests(
						request_id, review_id, status, available_at, requested_at, requested_by
					 ) VALUES ('recheck:2', 'review:hidden', 'processing', now(), now(), 'test')`,
				),
			).toBe("23505");
		} finally {
			await client.end();
		}
	});

	it("applies each runtime role's bounded Dining privileges", async () => {
		await migrateDining(databaseUrl);
		await createRoles(DINING_ROLES);
		await expect(applyDiningDatabaseGrants(databaseUrl, DINING_ROLES)).resolves.toEqual({
			roles: [...DINING_ROLES],
			status: "ready",
		});

		expect(
			await queryErrorCodeAsRole("app_api", "select * from dining.publication limit 0"),
		).toBeUndefined();
		expect(
			await queryErrorCodeAsRole("app_api", "select * from dining.source_sync_runs limit 0"),
		).toBe("42501");
		expect(
			await queryErrorCodeAsRole(
				"app_api",
				"update dining.publication set updated_at = updated_at where false",
			),
		).toBe("42501");

		expect(
			await queryErrorCodeAsRole(
				"ops_web_dining",
				"update dining.publication set updated_at = updated_at where false",
			),
		).toBeUndefined();
		expect(
			await queryErrorCodeAsRole(
				"ops_web_dining",
				"update dining.source_sync_runs set status = status where false",
			),
		).toBe("42501");

		expect(
			await queryErrorCodeAsRole(
				"dining_sync",
				"update dining.source_sync_runs set status = status where false",
			),
		).toBeUndefined();
		expect(
			await queryErrorCodeAsRole(
				"dining_sync",
				"update dining.catalog_state set updated_at = updated_at where false",
			),
		).toBe("42501");

		for (const role of DINING_ROLES) {
			expect(
				await queryErrorCodeAsRole(role, `create table dining.forbidden_${role}(id int)`),
			).toBe("42501");
		}
	});

	it("does not partially grant roles when one required role is missing", async () => {
		await migrateDining(databaseUrl);
		await createRoles(["app_api"]);

		await expect(
			applyDiningDatabaseGrants(databaseUrl, ["app_api", "ops_web_dining"]),
		).rejects.toThrow("ops_web_dining role is missing");

		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			const privilege = await client.query<{ canUse: boolean }>(
				`select has_schema_privilege('app_api', 'dining', 'USAGE') as "canUse"`,
			);
			expect(privilege.rows[0]?.canUse).toBe(false);
		} finally {
			await client.end();
		}
	});

	async function createRoles(roles: readonly DiningDatabaseRole[]): Promise<void> {
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			for (const role of roles) {
				await client.query(`CREATE ROLE "${role}" NOLOGIN`);
			}
		} finally {
			await client.end();
		}
	}

	async function queryErrorCodeAsRole(
		role: DiningDatabaseRole,
		sql: string,
	): Promise<string | undefined> {
		const client = new Client({ connectionString: databaseUrl });
		await client.connect();
		try {
			await client.query(`SET ROLE "${role}"`);
			await client.query(sql);
			return;
		} catch (error) {
			return postgresErrorCode(error);
		} finally {
			await client.end();
		}
	}
});

async function queryErrorCode(client: Client, sql: string): Promise<string | undefined> {
	try {
		await client.query(sql);
		return;
	} catch (error) {
		return postgresErrorCode(error);
	}
}

function postgresErrorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;
}
