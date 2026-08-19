// @vitest-environment node

import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createPgInternalPortalCredentialStore,
	InternalPortalCredentialConflictError,
	InternalPortalCredentialNameConflictError,
} from "../src/internal-portal-credential-store.ts";
import { loadIngestionControlMigrations, runIngestionControlMigrations } from "../src/migrate.ts";
import { runIngestionControlSchemaBootstrap } from "../src/schema-bootstrap.ts";

const POSTGRES_IMAGE =
	"postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193";
const RYUK_IMAGE =
	"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
const DATABASE_NAME = "campus_agent_ingestion_test";
const CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN_ID = "22222222-2222-4222-8222-222222222222";
const opsMigrationRoot = fileURLToPath(new URL("../../ops-web/drizzle/", import.meta.url));

function roleConnectionString(
	connectionString: string,
	username: string,
	password: string,
): string {
	const url = new URL(connectionString);
	url.username = username;
	url.password = password;
	return url.toString();
}

function databaseConnectionString(connectionString: string, databaseName: string): string {
	const url = new URL(connectionString);
	url.pathname = `/${databaseName}`;
	return url.toString();
}

describe("ingestion-control PostgreSQL ownership handoff", () => {
	let adminConnectionString = "";
	let container: StartedPostgreSqlContainer;
	let ingestionPassword = "";
	let ownerConnectionString = "";
	let ownerPassword = "";
	let opsWebConnectionString = "";
	let runtimeConnectionString = "";

	beforeAll(async () => {
		process.env.RYUK_CONTAINER_IMAGE = RYUK_IMAGE;
		container = await new PostgreSqlContainer(POSTGRES_IMAGE)
			.withResourcesQuota({ cpu: 1, memory: 0.5 })
			.withDatabase(DATABASE_NAME)
			.withUsername("postgres")
			.withPassword(randomUUID())
			.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
			.start();
		adminConnectionString = container.getConnectionUri();
		ingestionPassword = randomBytes(24).toString("hex");
		const opsWebPassword = randomBytes(24).toString("hex");
		ownerPassword = randomBytes(24).toString("hex");
		const admin = new Client({ connectionString: adminConnectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query(`CREATE ROLE ingestion_control LOGIN PASSWORD '${ingestionPassword}'`);
			await admin.query(`CREATE ROLE ops_web LOGIN PASSWORD '${opsWebPassword}'`);
			await admin.query("CREATE ROLE app_api LOGIN");
			await admin.query(
				`CREATE ROLE campus_agent LOGIN PASSWORD '${ownerPassword}' IN ROLE ingestion_control`,
			);
			await admin.query(`ALTER DATABASE ${DATABASE_NAME} OWNER TO campus_agent`);
		} finally {
			await admin.end();
		}
		ownerConnectionString = roleConnectionString(
			adminConnectionString,
			"campus_agent",
			ownerPassword,
		);
		opsWebConnectionString = roleConnectionString(adminConnectionString, "ops_web", opsWebPassword);
		runtimeConnectionString = roleConnectionString(
			adminConnectionString,
			"ingestion_control",
			ingestionPassword,
		);
	}, 180_000);

	afterAll(async () => {
		await container?.stop();
	}, 60_000);

	it("takes ownership of the deployed runtime schema before retiring Temporal tables", async () => {
		const legacyMigrations = loadIngestionControlMigrations().slice(0, -1);
		const admin = new Client({ connectionString: adminConnectionString, ssl: false });
		await admin.connect();
		try {
			await admin.query("CREATE SCHEMA ingestion_control AUTHORIZATION ingestion_control");
		} finally {
			await admin.end();
		}

		const legacyRuntime = new Client({ connectionString: runtimeConnectionString, ssl: false });
		await legacyRuntime.connect();
		try {
			await legacyRuntime.query(`CREATE TABLE ingestion_control.schema_migrations (
				migration_id text PRIMARY KEY,
				content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
				applied_at timestamptz NOT NULL DEFAULT now()
			)`);
			await legacyRuntime.query("CREATE TABLE ingestion_control.tasks (task_id text PRIMARY KEY)");
			for (const migration of legacyMigrations) {
				await legacyRuntime.query(
					`INSERT INTO ingestion_control.schema_migrations (migration_id, content_sha256)
					 VALUES ($1, $2)`,
					[migration.migrationId, migration.contentSha256],
				);
			}
		} finally {
			await legacyRuntime.end();
		}

		const owner = new Client({ connectionString: ownerConnectionString, ssl: false });
		await owner.connect();
		try {
			for (const migration of [
				"0001_dizzy_gateway.sql",
				"0002_faithful_puff_adder.sql",
				"0003_unique_internal_portal_credential_name.sql",
			]) {
				await applyStatementBreakpoints(owner, `${opsMigrationRoot}/${migration}`);
			}
			await owner.query(
				`INSERT INTO internal_portal.credentials (
				credential_id, name, sso_tgc, version, created_at, updated_at,
				last_attempt_at, last_successful_at, last_outcome
			) VALUES (
				$1, '开发凭据', 'TGT-before-handoff', 3,
				'2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z',
				'2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z', 'valid'
			)`,
				[CREDENTIAL_ID],
			);
			await owner.query(
				`INSERT INTO internal_portal.automation_tokens (
				token_id, name, token_value, token_hash, created_at, revoked_at
			) VALUES ($1, '开发同步程序', 'ops_secret', $2, '2026-08-01T00:00:00Z', NULL)`,
				[TOKEN_ID, "a".repeat(64)],
			);
			await applyStatementBreakpoints(owner, `${opsMigrationRoot}/0004_loud_loa.sql`);
			await owner.query("GRANT USAGE ON SCHEMA internal_portal TO ops_web");
			await owner.query(
				"GRANT SELECT, INSERT, UPDATE, DELETE ON internal_portal.automation_tokens TO ops_web",
			);
		} finally {
			await owner.end();
		}

		const env = {
			DEPLOYMENT_ENVIRONMENT: "local",
			INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
			INGESTION_CONTROL_SCHEMA_DATABASE_URL: ownerConnectionString,
		};
		await runIngestionControlSchemaBootstrap(env);
		await expect(runIngestionControlMigrations(env)).resolves.toEqual([
			"0007_retire_temporal_tasks.sql",
		]);
		await expect(runIngestionControlMigrations(env)).resolves.toEqual([]);

		const runtime = new Client({ connectionString: runtimeConnectionString, ssl: false });
		const opsWeb = new Client({ connectionString: opsWebConnectionString, ssl: false });
		const ownerInspector = new Client({ connectionString: ownerConnectionString, ssl: false });
		await Promise.all([runtime.connect(), opsWeb.connect(), ownerInspector.connect()]);
		try {
			const handoff = await runtime.query(`select
				credential_id as "credentialId", name, sso_tgc as "ssoTgc", version,
				created_at as "createdAt", updated_at as "updatedAt",
				last_attempt_at as "lastAttemptAt", last_successful_at as "lastSuccessfulAt",
				last_outcome as "lastOutcome"
			from ingestion_control.internal_portal_credentials`);
			expect(handoff.rows).toEqual([
				{
					createdAt: new Date("2026-08-01T00:00:00.000Z"),
					credentialId: CREDENTIAL_ID,
					lastAttemptAt: new Date("2026-08-02T00:00:00.000Z"),
					lastOutcome: "valid",
					lastSuccessfulAt: new Date("2026-08-02T00:00:00.000Z"),
					name: "开发凭据",
					ssoTgc: "TGT-before-handoff",
					updatedAt: new Date("2026-08-02T00:00:00.000Z"),
					version: 3,
				},
			]);
			const retired = await ownerInspector.query(`select
				to_regclass('internal_portal.credentials')::text as "legacyCredentials",
				to_regclass('ingestion_control.tasks')::text as "tasks"`);
			expect(retired.rows[0]).toEqual({ legacyCredentials: null, tasks: null });
			const ownership = await ownerInspector.query(`select
				(select pg_get_userbyid(nspowner) from pg_namespace
				 where nspname = 'ingestion_control') as "schemaOwner",
				(select tableowner from pg_tables
				 where schemaname = 'ingestion_control' and tablename = 'schema_migrations')
				 as "journalOwner",
				(select tableowner from pg_tables
				 where schemaname = 'ingestion_control' and tablename = 'internal_portal_credentials')
				 as "credentialsOwner"`);
			expect(ownership.rows[0]).toEqual({
				credentialsOwner: "campus_agent",
				journalOwner: "campus_agent",
				schemaOwner: "campus_agent",
			});
			await runtime.query("begin");
			try {
				await expect(
					runtime.query(`insert into ingestion_control.internal_portal_credentials (
						credential_id, name, sso_tgc, version, created_at, updated_at
					) values (
						'33333333-3333-4333-8333-333333333333', '权限探针', 'TGT-probe', 1, now(), now()
					)`),
				).resolves.toMatchObject({ rowCount: 1 });
				await expect(
					runtime.query(`update ingestion_control.internal_portal_credentials
					 set version = 2, updated_at = now()
					 where credential_id = '33333333-3333-4333-8333-333333333333'`),
				).resolves.toMatchObject({ rowCount: 1 });
				await expect(
					runtime.query(`delete from ingestion_control.internal_portal_credentials
					 where credential_id = '33333333-3333-4333-8333-333333333333'`),
				).resolves.toMatchObject({ rowCount: 1 });
			} finally {
				await runtime.query("rollback");
			}
			await expect(
				runtime.query("create table ingestion_control.runtime_ddl_probe (id integer)"),
			).rejects.toThrow("permission denied for schema ingestion_control");
			await expect(
				runtime.query("create view ingestion_control.runtime_view_probe as select 1 as id"),
			).rejects.toThrow("permission denied for schema ingestion_control");
			await expect(
				runtime.query(
					"alter table ingestion_control.internal_portal_credentials add column runtime_probe integer",
				),
			).rejects.toThrow();
			await expect(
				runtime.query("drop table ingestion_control.internal_portal_credentials"),
			).rejects.toThrow();
			await expect(
				runtime.query("select * from ingestion_control.schema_migrations"),
			).rejects.toThrow("permission denied");
			await expect(
				opsWeb.query("select * from ingestion_control.internal_portal_credentials"),
			).rejects.toThrow("permission denied");
			await expect(
				opsWeb.query("select token_id from internal_portal.automation_tokens"),
			).resolves.toMatchObject({ rowCount: 1 });

			const store = createPgInternalPortalCredentialStore(runtime);
			await expect(
				store.create({
					credentialId: randomUUID(),
					name: "开发凭据",
					now: new Date("2026-08-03T00:00:00.000Z"),
					ssoTgc: "TGT-duplicate",
				}),
			).rejects.toBeInstanceOf(InternalPortalCredentialNameConflictError);
			await expect(
				store.rotate({
					attemptedAt: new Date("2026-08-03T00:00:00.000Z"),
					credentialId: CREDENTIAL_ID,
					expectedVersion: 2,
					ssoTgc: "TGT-stale",
				}),
			).rejects.toBeInstanceOf(InternalPortalCredentialConflictError);
		} finally {
			await Promise.all([runtime.end(), opsWeb.end(), ownerInspector.end()]);
		}
	});

	it("installs the same owner and runtime boundary in a fresh database", async () => {
		const databaseName = `ingestion_fresh_${randomUUID().replaceAll("-", "")}`;
		const admin = new Client({ connectionString: adminConnectionString, ssl: false });
		await admin.connect();
		await admin.query(`CREATE DATABASE "${databaseName}" OWNER campus_agent`);

		const freshAdminUrl = databaseConnectionString(adminConnectionString, databaseName);
		const freshOwnerUrl = roleConnectionString(freshAdminUrl, "campus_agent", ownerPassword);
		const freshRuntimeUrl = roleConnectionString(
			freshAdminUrl,
			"ingestion_control",
			ingestionPassword,
		);
		try {
			const owner = new Client({ connectionString: freshOwnerUrl, ssl: false });
			await owner.connect();
			try {
				for (const migration of [
					"0001_dizzy_gateway.sql",
					"0002_faithful_puff_adder.sql",
					"0003_unique_internal_portal_credential_name.sql",
					"0004_loud_loa.sql",
				]) {
					await applyStatementBreakpoints(owner, `${opsMigrationRoot}/${migration}`);
				}
			} finally {
				await owner.end();
			}

			const env = {
				DEPLOYMENT_ENVIRONMENT: "local",
				INGESTION_CONTROL_SCHEMA_DATABASE_SSLMODE: "disable",
				INGESTION_CONTROL_SCHEMA_DATABASE_URL: freshOwnerUrl,
			};
			await runIngestionControlSchemaBootstrap(env);
			await expect(runIngestionControlMigrations(env)).resolves.toEqual(
				loadIngestionControlMigrations().map((migration) => migration.migrationId),
			);
			await expect(runIngestionControlMigrations(env)).resolves.toEqual([]);

			const runtime = new Client({ connectionString: freshRuntimeUrl, ssl: false });
			const ownerInspector = new Client({ connectionString: freshOwnerUrl, ssl: false });
			await Promise.all([runtime.connect(), ownerInspector.connect()]);
			try {
				await expect(
					runtime.query("select * from ingestion_control.internal_portal_credentials"),
				).resolves.toBeDefined();
				await expect(
					runtime.query("create table ingestion_control.runtime_ddl_probe (id integer)"),
				).rejects.toThrow("permission denied for schema ingestion_control");
				const ownership = await ownerInspector.query(`select
					(select pg_get_userbyid(nspowner) from pg_namespace
					 where nspname = 'ingestion_control') as "schemaOwner",
					(select tableowner from pg_tables
					 where schemaname = 'ingestion_control' and tablename = 'schema_migrations')
					 as "journalOwner",
					(select tableowner from pg_tables
					 where schemaname = 'ingestion_control' and tablename = 'internal_portal_credentials')
					 as "credentialsOwner"`);
				expect(ownership.rows[0]).toEqual({
					credentialsOwner: "campus_agent",
					journalOwner: "campus_agent",
					schemaOwner: "campus_agent",
				});
			} finally {
				await Promise.all([runtime.end(), ownerInspector.end()]);
			}
		} finally {
			await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
			await admin.end();
		}
	});
});

async function applyStatementBreakpoints(client: Client, path: string): Promise<void> {
	const sql = await readFile(path, "utf8");
	for (const statement of sql.split(/\n?--> statement-breakpoint\n?/u)) {
		if (statement.trim()) {
			await client.query(statement);
		}
	}
}
