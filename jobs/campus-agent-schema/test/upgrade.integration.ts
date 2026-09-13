import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { createMigration, readHistory } from "../src/history.ts";
import {
	inspectCampusAgentSchema,
	MIGRATIONS_FOLDER,
	migrateCampusAgentSchema,
} from "../src/migrate.ts";

const image =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const fixture = JSON.parse(
	await readFile(new URL("fixtures/v0-history.json", import.meta.url), "utf8"),
) as Array<{ name: string; hash: string; created_at: string }>;
const authMigrationName = "20260914073252_better_auth_provider_account_key";

test("unified schema: real PostgreSQL installation, v0 upgrades and failure recovery", {
	timeout: 240_000,
}, async (t) => {
	process.env.RYUK_CONTAINER_IMAGE ??=
		"testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0";
	const container = await new PostgreSqlContainer(image)
		.withUsername("postgres")
		.withPassword(randomUUID())
		.withResourcesQuota({ cpu: 1, memory: 0.5 })
		.start();
	const clients: Client[] = [];
	t.after(async () => {
		try {
			await Promise.all(clients.map((client) => client.end()));
		} finally {
			await container.stop();
		}
	});
	const admin = new Client({ connectionString: container.getConnectionUri() });
	await admin.connect();
	clients.push(admin);
	const password = randomUUID();
	await admin.query(`create role campus_agent login password '${password}'`);
	for (const role of ["app_api", "execution_control", "ops_web", "model_config"]) {
		await admin.query(`create role ${role}`);
	}
	const local = readHistory(MIGRATIONS_FOLDER);
	const authMigration = local.find((entry) => entry.name === authMigrationName);
	assert(authMigration);
	const env = {
		PGHOST: container.getHost(),
		PGPORT: String(container.getPort()),
		PGUSER: "campus_agent",
		PGPASSWORD: password,
		PGSSLMODE: "disable",
	};
	async function database() {
		const name = `migration_${randomUUID().replaceAll("-", "")}`;
		await admin.query(`create database ${name} owner campus_agent`);
		const config = { ...env, PGDATABASE: name };
		const client = new Client({
			host: env.PGHOST,
			port: Number(env.PGPORT),
			user: env.PGUSER,
			password,
			database: name,
		});
		await client.connect();
		clients.push(client);
		return { config, client };
	}
	async function legacy(client: Client, withMemory: boolean) {
		await client.query("begin");
		await client.query(
			"create schema drizzle; create table drizzle.campus_agent_migrations(id serial primary key, hash text not null, created_at bigint)",
		);
		for (const entry of fixture) {
			if (!withMemory && entry.name.endsWith("personal_memory_management")) {
				continue;
			}
			const migration = local.find((item) => item.name === entry.name);
			assert(migration);
			assert.equal(migration.hash, entry.hash, `Released SQL changed: ${entry.name}`);
			for (const sql of migration.sql) {
				await client.query(sql);
			}
			await client.query(
				"insert into drizzle.campus_agent_migrations(hash,created_at) values($1,$2)",
				[entry.hash, entry.created_at],
			);
		}
		await client.query("commit");
	}
	async function ready(client: Client) {
		await assertAuthShape(client, true);
		await client.query(
			`insert into app_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt")
			 values ('new-user','New student','new@example.test',true,now(),now());
			 insert into app_auth.account (id,"accountId","providerId","userId",password,"createdAt","updatedAt")
			 values ('new-account','new-user','credential','new-user','new-password-hash',now(),now());`,
		);
		assert.equal(
			(await client.query("select issuer from app_auth.account where id='new-account'")).rows[0]
				.issuer,
			null,
		);
		await client.query("delete from app_auth.\"user\" where id='new-user'");
		const columns = await client.query<{ column_name: string }>(
			"select column_name from information_schema.columns where table_schema='execution_control' and table_name='personal_memory_call_leases'",
		);
		assert(
			!columns.rows.some(
				(row) => row.column_name === "owner_sequence" || row.column_name === "subject_scope_hash",
			),
		);
		await client.query("select payload from profile.memory_commands limit 1");
		await client.query(
			"insert into execution_control.personal_memory_call_leases(call_id,owner_scope_hash,generation,operation_kind,expires_at) values('smoke','owner',1,'append',now())",
		);
		await client.query(
			"delete from execution_control.personal_memory_call_leases where call_id='smoke'",
		);
		const grants = await client.query(
			"select has_table_privilege('app_api','chat.messages','SELECT,INSERT,UPDATE,DELETE') as chat, has_table_privilege('ops_web','transport.schedule_period_notices','SELECT') as transport, has_schema_privilege('execution_control','execution_control','CREATE') as ddl",
		);
		assert.deepEqual(grants.rows[0], { chat: true, transport: true, ddl: false });
		const runGrants = await client.query(`select
			has_schema_privilege('app_api', 'execution_control', 'USAGE') as usage,
			has_column_privilege('app_api', 'execution_control.agent_runs', 'request_id', 'SELECT') as request,
			has_column_privilege('app_api', 'execution_control.agent_runs', 'status', 'SELECT') as status,
			has_table_privilege('app_api', 'execution_control.agent_runs', 'SELECT') as full_table,
			has_column_privilege('app_api', 'execution_control.agent_runs', 'metadata_json', 'SELECT') as metadata,
			has_table_privilege('app_api', 'execution_control.agent_runs', 'INSERT,UPDATE,DELETE') as write,
			has_any_column_privilege('app_api', 'execution_control.agent_run_events', 'SELECT') as events`);
		assert.deepEqual(runGrants.rows[0], {
			usage: true,
			request: true,
			status: true,
			full_table: false,
			metadata: false,
			write: false,
			events: false,
		});
	}
	async function assertAuthShape(client: Client, upgraded: boolean) {
		const result = await client.query(
			`select is_nullable = 'YES' as nullable,
			 to_regclass('app_auth."account_issuer_accountId_uidx"') is not null as issuer_index
			 from information_schema.columns
			 where table_schema='app_auth' and table_name='account' and column_name='issuer'`,
		);
		assert.deepEqual(result.rows, [{ nullable: upgraded, issuer_index: !upgraded }]);
	}
	async function seedRetainedAuth(client: Client) {
		await client.query(
			`insert into app_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt")
			 values ('retained','Student','retained@example.test',true,now(),now());
			 insert into app_auth.account (id,"accountId","providerId","userId",issuer,password,"createdAt","updatedAt")
			 values ('retained-account','retained','credential','retained','local:credential','retained-password-hash',now(),now());
			 insert into app_auth.session (id,token,"userId","expiresAt","createdAt","updatedAt")
			 values ('retained-session','retained-session-token','retained',now()+interval '1 day',now(),now());`,
		);
		return readRetainedAuth(client);
	}
	async function readRetainedAuth(client: Client) {
		return {
			user: (await client.query("select * from app_auth.\"user\" where id='retained'")).rows,
			account: (await client.query("select * from app_auth.account where id='retained-account'"))
				.rows,
			session: (await client.query("select * from app_auth.session where id='retained-session'"))
				.rows,
		};
	}
	await t.test("empty database, repeated run and concurrent migrators", async () => {
		const { config, client } = await database();
		assert.equal((await inspectCampusAgentSchema(config)).status, "missing");
		const results = await Promise.all([
			migrateCampusAgentSchema(config),
			migrateCampusAgentSchema(config),
		]);
		assert.deepEqual(results.map((result) => result.result).sort(), ["applied", "current"]);
		await ready(client);
		assert.equal((await inspectCampusAgentSchema(config)).status, "current");
		assert.equal((await migrateCampusAgentSchema(config)).result, "current");
	});
	await t.test(
		"named ledger applies only the auth migration and retains credentials and sessions",
		async () => {
			const { config, client } = await database();
			const folder = await mkdtemp(join(tmpdir(), "campus-schema-before-auth-"));
			t.after(() => rm(folder, { recursive: true, force: true }));
			await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
			await rm(join(folder, authMigrationName), { recursive: true });
			await migrateCampusAgentSchema(config, folder);
			await assertAuthShape(client, false);
			const retained = await seedRetainedAuth(client);
			const before = await client.query(
				"select * from drizzle.campus_agent_migrations order by id",
			);
			assert.deepEqual((await inspectCampusAgentSchema(config)).pendingMigrations, [
				authMigrationName,
			]);
			assert.equal((await migrateCampusAgentSchema(config)).result, "applied");
			await ready(client);
			assert.deepEqual(await readRetainedAuth(client), retained);
			const after = await client.query("select * from drizzle.campus_agent_migrations order by id");
			assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
			assert.equal(after.rows.length, before.rows.length + 1);
			assert.equal(after.rows.at(-1)?.name, authMigrationName);
			assert.equal((await inspectCampusAgentSchema(config)).status, "current");
			assert.equal((await migrateCampusAgentSchema(config)).result, "current");
		},
	);
	for (const withMemory of [false, true]) {
		await t.test(
			withMemory
				? "v0 complete: does not rerun destructive migrations"
				: "staging v0: applies the skipped memory and new auth migrations",
			async () => {
				const { config, client } = await database();
				await legacy(client, withMemory);
				await assertAuthShape(client, false);
				const retainedAuth = await seedRetainedAuth(client);
				await client.query(
					"insert into profile.memory_settings(owner_user_id,lifecycle_state,updated_at) values('retained','active',now())",
				);
				await client.query(
					"insert into chat.conversations(id,owner_user_id,title,created_at,updated_at) values('retained-chat','retained','Migration smoke',now(),now())",
				);
				await client.query(
					"insert into chat.messages(id,conversation_id,role,text,created_at) values('retained-message','retained-chat','user','Keep my conversation',now())",
				);
				await client.query(
					"insert into campus_docs_serving.current_index(singleton,collection) values(true,$1)",
					[`campus_docs_${"a".repeat(64)}`],
				);
				const before = await client.query(
					"select id,hash,created_at::text from drizzle.campus_agent_migrations order by id",
				);
				const status = await inspectCampusAgentSchema(config);
				assert.equal(status.status, "pending");
				const appliedNames = new Set(
					fixture
						.filter((entry) => withMemory || !entry.name.endsWith("personal_memory_management"))
						.map((entry) => entry.name),
				);
				assert.deepEqual(
					status.pendingMigrations,
					local.filter((entry) => !appliedNames.has(entry.name)).map((entry) => entry.name),
				);
				await migrateCampusAgentSchema(config);
				await ready(client);
				assert.deepEqual(await readRetainedAuth(client), retainedAuth);
				const after = await client.query(
					"select id,hash,created_at::text from drizzle.campus_agent_migrations order by id",
				);
				assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
				assert.equal(after.rows.length, local.length);
				const retained = await client.query(
					"select lifecycle_state from profile.memory_settings where owner_user_id='retained'",
				);
				assert.equal(retained.rows[0].lifecycle_state, withMemory ? "active" : "erased");
				assert.equal(
					(await client.query("select id from app_auth.\"user\" where id='retained'")).rowCount,
					1,
				);
				assert.equal(
					(await client.query("select text from chat.messages where id='retained-message'")).rows[0]
						.text,
					"Keep my conversation",
				);
				assert.equal(
					(await client.query("select collection from campus_docs_serving.current_index")).rows[0]
						.collection,
					`campus_docs_${"a".repeat(64)}`,
				);
				assert.equal((await migrateCampusAgentSchema(config)).result, "current");
			},
		);
	}
	await t.test("unknown history and changed SQL fail before applying new DDL", async () => {
		const { config, client } = await database();
		await legacy(client, false);
		await client.query("update drizzle.campus_agent_migrations set hash='changed' where id=1");
		await assert.rejects(
			migrateCampusAgentSchema(config),
			/Unknown or ambiguous applied migration/u,
		);
		await client.query("update drizzle.campus_agent_migrations set hash=$1 where id=1", [
			fixture[0]?.hash,
		]);
		await migrateCampusAgentSchema(config);
		await client.query("update drizzle.campus_agent_migrations set hash='changed' where id=1");
		await assert.rejects(inspectCampusAgentSchema(config), /Applied migration SQL changed/u);
	});
	await t.test(
		"missing earlier names run, failing batch rolls back and can be retried",
		async () => {
			const { config, client } = await database();
			await migrateCampusAgentSchema(config);
			const folder = await mkdtemp(join(tmpdir(), "campus-schema-upgrade-"));
			t.after(() => rm(folder, { recursive: true, force: true }));
			await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
			const name = "20260101000000_earlier_missing";
			await mkdir(join(folder, name));
			const path = join(folder, name, "migration.sql");
			await writeFile(
				path,
				"create table public.upgrade_probe(id integer); --> statement-breakpoint\n select missing_column from public.upgrade_probe;",
			);
			await assert.rejects(migrateCampusAgentSchema(config, folder));
			assert.equal(
				(await client.query("select to_regclass('public.upgrade_probe') as relation")).rows[0]
					.relation,
				null,
			);
			assert.deepEqual((await inspectCampusAgentSchema(config, folder)).pendingMigrations, [name]);
			await writeFile(path, "create table public.upgrade_probe(id integer);");
			await migrateCampusAgentSchema(config, folder);
			assert.equal((await inspectCampusAgentSchema(config, folder)).status, "current");
			await client.query("select id from public.upgrade_probe");
		},
	);
	await t.test("v0 ledger conversion survives a rolled-back SQL batch and retry", async () => {
		const { config, client } = await database();
		await legacy(client, false);
		const folder = await mkdtemp(join(tmpdir(), "campus-schema-v0-retry-"));
		t.after(() => rm(folder, { recursive: true, force: true }));
		await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
		const path = createMigration(
			folder,
			"retry_probe",
			new Date(authMigration.folderMillis + 1000),
		);
		await writeFile(path, "select missing_column from profile.memory_settings;");
		await assert.rejects(migrateCampusAgentSchema(config, folder));
		const converted = await client.query(
			"select name from drizzle.campus_agent_migrations order by id",
		);
		assert.deepEqual(
			converted.rows.map((row) => row.name),
			fixture
				.filter((entry) => !entry.name.endsWith("personal_memory_management"))
				.map((entry) => entry.name),
		);
		await assert.rejects(client.query("select payload from profile.memory_commands limit 1"));
		await assertAuthShape(client, false);
		const appliedNames = new Set(
			fixture
				.filter((entry) => !entry.name.endsWith("personal_memory_management"))
				.map((entry) => entry.name),
		);
		assert.deepEqual(
			(await inspectCampusAgentSchema(config, folder)).pendingMigrations,
			readHistory(folder)
				.filter((entry) => !appliedNames.has(entry.name))
				.map((entry) => entry.name),
		);
		await writeFile(path, "select 1;");
		await migrateCampusAgentSchema(config, folder);
		await ready(client);
		assert.equal((await inspectCampusAgentSchema(config, folder)).status, "current");
		assert.equal((await migrateCampusAgentSchema(config, folder)).result, "current");
	});
	await t.test("legacy runner objects and non-owner execution are rejected", async () => {
		const { config, client } = await database();
		await client.query("create schema execution_config");
		assert.equal((await inspectCampusAgentSchema(config)).status, "legacy");
		await assert.rejects(migrateCampusAgentSchema(config), /legacy database objects/u);
		await assert.rejects(
			migrateCampusAgentSchema({
				...config,
				PGUSER: "postgres",
				PGPASSWORD: container.getPassword(),
			}),
			/must run as campus_agent/u,
		);
	});
});
