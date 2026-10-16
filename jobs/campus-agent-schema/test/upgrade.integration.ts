import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";
import { readHistory } from "../src/history.ts";
import { databaseDrainCounts, verifyAgentControlRuntime } from "../src/maintenance.ts";
import {
	inspectCampusAgentSchema,
	MEMORY_MIGRATIONS_FOLDER,
	MIGRATIONS_FOLDER,
	migrateCampusAgentSchema,
	readDatabaseConfig,
} from "../src/migrate.ts";

const image =
	"postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const authMigrationName = "20260914073252_better_auth_provider_account_key";
const memoryRetirementMigrationName = "20261012090000_retire_legacy_memory_state";
const agentControlRenameMigrationName = "20261014090000_rename_execution_control_to_agent_control";
const agentControlConnectMigrationName = "20261016110000_agent_control_connect";

test("unified schema: real PostgreSQL installation and failure recovery", {
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
	const agentControlPassword = randomUUID();
	await admin.query(`create role agent_control login password '${agentControlPassword}'`);
	for (const role of [
		"app_api",
		// The old role remains during the migration and is retired only after
		// every consumer has switched to agent_control.
		"execution_control",
		"campus_search",
		"ops_web",
		"model_config",
		"product_data_ro",
	]) {
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
	async function ready(client: Client) {
		const roles = await client.query(
			"select rolname from pg_roles where rolname in ('agent_control', 'execution_control') order by rolname",
		);
		assert.deepEqual(roles.rows, [{ rolname: "agent_control" }, { rolname: "execution_control" }]);
		const search = await client.query(`select
		  has_schema_privilege('campus_search', 'campus_docs_serving', 'USAGE') as usage,
		  has_table_privilege('campus_search', 'campus_docs_serving.current_index', 'SELECT') as read,
		  has_table_privilege('campus_search', 'campus_docs_serving.current_index', 'INSERT,UPDATE,DELETE') as write,
		  has_schema_privilege('campus_search', 'agent_control', 'USAGE') as execution`);
		assert.deepEqual(search.rows[0], { usage: true, read: true, write: false, execution: false });
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
		for (const name of [
			"personal_memory_call_leases",
			"personal_memory_command_receipts",
			"personal_memory_owner_fences",
		]) {
			assert.equal(
				(await client.query("select to_regclass($1) as relation", [`agent_control.${name}`]))
					.rows[0].relation,
				null,
			);
		}
		await client.query("select payload from profile.memory_commands limit 1");
		await client.query("select 1 from agent_control.agent_memory_deliveries limit 1");
		const grants = await client.query(
			"select has_table_privilege('app_api','chat.messages','SELECT,INSERT,UPDATE,DELETE') as chat, has_table_privilege('ops_web','transport.schedule_period_notices','SELECT') as transport, has_schema_privilege('agent_control','agent_control','CREATE') as ddl, has_table_privilege('agent_control','agent_control.agent_runs','SELECT,INSERT,UPDATE,DELETE') as agent_runs",
		);
		assert.deepEqual(grants.rows[0], { chat: true, transport: true, ddl: false, agent_runs: true });
		const runGrants = await client.query(`select
			has_schema_privilege('app_api', 'agent_control', 'USAGE') as usage,
			has_column_privilege('app_api', 'agent_control.agent_runs', 'request_id', 'SELECT') as request,
			has_column_privilege('app_api', 'agent_control.agent_runs', 'status', 'SELECT') as status,
			has_table_privilege('app_api', 'agent_control.agent_runs', 'SELECT') as full_table,
			has_column_privilege('app_api', 'agent_control.agent_runs', 'metadata_json', 'SELECT') as metadata,
			has_table_privilege('app_api', 'agent_control.agent_runs', 'INSERT,UPDATE,DELETE') as write,
			has_any_column_privilege('app_api', 'agent_control.agent_run_events', 'SELECT') as events`);
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
	await t.test("agent-control runtime access survives a restricted database ACL", async () => {
		const { config, client } = await database();
		await admin.query(`revoke connect on database ${config.PGDATABASE} from public`);
		await migrateCampusAgentSchema(config);
		const runtime = new Client({
			...readDatabaseConfig({
				...config,
				PGUSER: "agent_control",
				PGPASSWORD: agentControlPassword,
			}),
		});
		await runtime.connect();
		clients.push(runtime);
		await verifyAgentControlRuntime(client, runtime);
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
	await t.test(
		"retire populated legacy Memory state without changing current product or delivery data",
		async () => {
			const { config, client } = await database();
			const folder = await mkdtemp(join(tmpdir(), "campus-schema-before-memory-retirement-"));
			t.after(() => rm(folder, { recursive: true, force: true }));
			await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
			// Build the legacy state before both the retirement and schema rename
			// migrations. The default folder then applies them in order.
			await rm(join(folder, memoryRetirementMigrationName), { recursive: true });
			await rm(join(folder, agentControlRenameMigrationName), { recursive: true });
			await rm(join(folder, agentControlConnectMigrationName), { recursive: true });
			await migrateCampusAgentSchema(config, folder);
			// Both real schemas are present so drain queries cannot silently drift from DDL.
			for (const migration of readHistory(MEMORY_MIGRATIONS_FOLDER)) {
				for (const sql of migration.sql) {
					await client.query(sql);
				}
			}
			assert.equal(
				Object.values(await databaseDrainCounts(client, client)).every((count) => count === 0),
				true,
			);
			await client.query(`
			insert into execution_control.personal_memory_owner_fences values ('legacy-owner',1,'active',1,now());
			insert into execution_control.personal_memory_call_leases (call_id,owner_scope_hash,generation,operation_kind,expires_at)
			values ('legacy-call','legacy-owner',1,'append',null);
			insert into execution_control.personal_memory_command_receipts
			(command_id,owner_scope_hash,generation,sequence,kind,status,subject_scope_hash,supersession_scope,created_at,updated_at)
			values ('legacy-command','legacy-owner',1,1,'add','succeeded','subject','owner',now(),now());
			insert into execution_control.agent_runs (conversation_id,request_id,owner_user_id,surface,task_queue,status,created_at,updated_at)
			values ('conversation','retained-run','retained-owner','chat','agent','completed',now(),now());
			insert into execution_control.agent_memory_deliveries (request_id,owner_user_id,payload,status)
			values ('retained-run','retained-owner','{"messages":["retain this"]}','ready');
			insert into profile.memory_commands
			(command_id,owner_user_id,owner_generation,owner_sequence,command_kind,supersession_scope,accepted_lifecycle_state,source_updated_at,idempotency_key_hash,request_fingerprint,created_at,updated_at,payload)
			values ('retained-command','retained-owner',1,1,'add','owner','active',now(),'key','fingerprint',now(),now(),'{"text":"retain this"}');
		`);
			const pending = await databaseDrainCounts(client, client);
			assert.equal(pending.deliveries, 1);
			assert.equal(pending.commands, 1);
			const legacyTables = [
				"execution_control.agent_runs",
				"execution_control.agent_memory_deliveries",
				"profile.memory_commands",
			];
			const before: unknown[][] = [];
			for (const table of legacyTables) {
				before.push((await client.query(`select * from ${table}`)).rows);
			}
			assert.deepEqual((await inspectCampusAgentSchema(config)).pendingMigrations, [
				memoryRetirementMigrationName,
				agentControlRenameMigrationName,
				agentControlConnectMigrationName,
			]);
			await migrateCampusAgentSchema(config);
			await ready(client);
			const currentTables = [
				"agent_control.agent_runs",
				"agent_control.agent_memory_deliveries",
				"profile.memory_commands",
			];
			const after: unknown[][] = [];
			for (const table of currentTables) {
				after.push((await client.query(`select * from ${table}`)).rows);
			}
			assert.deepEqual(after, before);
		},
	);
	await t.test("auth migration rejects duplicate provider identities", async () => {
		const { config, client } = await database();
		const folder = await mkdtemp(join(tmpdir(), "campus-schema-duplicate-auth-"));
		t.after(() => rm(folder, { recursive: true, force: true }));
		await cp(MIGRATIONS_FOLDER, folder, { recursive: true });
		await rm(join(folder, authMigrationName), { recursive: true });
		await migrateCampusAgentSchema(config, folder);
		await client.query(
			`insert into app_auth."user" (id,name,email,"emailVerified","createdAt","updatedAt")
			 values ('duplicate-a','Student A','duplicate-a@example.test',true,now(),now()),
			        ('duplicate-b','Student B','duplicate-b@example.test',true,now(),now());
			 insert into app_auth.account (id,"accountId","providerId","userId",issuer,password,"createdAt","updatedAt")
			 values ('duplicate-account-a','same-account','credential','duplicate-a','local:credential-a','hash-a',now(),now()),
			        ('duplicate-account-b','same-account','credential','duplicate-b','local:credential-b','hash-b',now(),now());`,
		);
		await assert.rejects(
			migrateCampusAgentSchema(config),
			/duplicate \(providerId, accountId\) identities exist/u,
		);
		await assertAuthShape(client, false);
	});
	await t.test("unknown history and changed SQL fail before applying new DDL", async () => {
		const { config, client } = await database();
		await migrateCampusAgentSchema(config);
		await client.query("update drizzle.campus_agent_migrations set hash='changed' where id=1");
		await assert.rejects(migrateCampusAgentSchema(config), /Applied migration SQL changed/u);
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
	await t.test("non-owner execution is rejected", async () => {
		const { config } = await database();
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
