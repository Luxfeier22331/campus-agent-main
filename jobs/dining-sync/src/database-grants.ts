import { Client } from "pg";

export type DiningDatabaseRole = "app_api" | "dining_sync" | "ops_web_dining";

const APP_API_READ_TABLES = new Set(["publication", "releases", "reviews"]);
const DINING_SYNC_READ_TABLES = new Set([
	"publication",
	"releases",
	"review_overrides",
	"review_recheck_requests",
	"reviews",
	"source_observations",
	"source_sync_runs",
]);
const DINING_SYNC_WRITE_TABLES = new Set([
	"publication",
	"review_recheck_requests",
	"reviews",
	"source_observations",
	"source_sync_runs",
]);
const OPS_WEB_DINING_WRITE_TABLES = new Set([
	"catalog_overrides",
	"catalog_state",
	"floors",
	"halls",
	"menu_items",
	"menu_offerings",
	"operation_events",
	"publication",
	"releases",
	"review_overrides",
	"review_recheck_requests",
	"reviews",
	"stall_profiles",
	"window_assignments",
	"windows",
]);
const EMPTY_TABLES = new Set<string>();
const EXPECTED_DINING_TABLES = new Set([
	...APP_API_READ_TABLES,
	...DINING_SYNC_READ_TABLES,
	...OPS_WEB_DINING_WRITE_TABLES,
]);

interface DiningPrivilegeRow {
	canDelete: boolean;
	canInsert: boolean;
	canReferences: boolean;
	canSelect: boolean;
	canTrigger: boolean;
	canTruncate: boolean;
	canUpdate: boolean;
	tableName: string;
}

export interface DiningDatabaseGrantReport {
	roles: DiningDatabaseRole[];
	status: "ready";
}

export async function applyDiningDatabaseGrants(
	databaseUrl: string,
	roles: readonly DiningDatabaseRole[],
): Promise<DiningDatabaseGrantReport> {
	const requestedRoles = [...new Set(roles)];
	if (requestedRoles.length === 0) {
		throw new Error("At least one Dining database role is required.");
	}

	const client = new Client({ connectionString: databaseUrl });
	await client.connect();
	try {
		await client.query("begin");
		try {
			await assertDiningSchema(client);
			for (const role of requestedRoles) {
				await assertDatabaseRole(client, role);
			}
			for (const role of requestedRoles) {
				await resetDiningPrivileges(client, role);
				await grantDiningPrivileges(client, role);
				await verifyDiningPrivileges(client, role);
			}
			await client.query("commit");
		} catch (error) {
			try {
				await client.query("rollback");
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					"Dining database grants failed and the transaction could not be rolled back.",
				);
			}
			throw error;
		}
	} finally {
		await client.end();
	}

	return { roles: requestedRoles, status: "ready" };
}

async function assertDiningSchema(client: Client): Promise<void> {
	const result = await client.query<{ present: boolean }>(
		"select to_regnamespace('dining') is not null as present",
	);
	if (result.rows[0]?.present !== true) {
		throw new Error("dining schema is missing; run the Dining migration before applying grants.");
	}
}

async function assertDatabaseRole(client: Client, role: DiningDatabaseRole): Promise<void> {
	const result = await client.query<{ present: boolean }>(
		"select exists(select 1 from pg_roles where rolname = $1) as present",
		[role],
	);
	if (result.rows[0]?.present !== true) {
		throw new Error(`${role} role is missing; create it before applying Dining grants.`);
	}
}

async function resetDiningPrivileges(client: Client, role: DiningDatabaseRole): Promise<void> {
	await client.query(`REVOKE ALL PRIVILEGES ON SCHEMA "dining" FROM "${role}"`);
	await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "dining" FROM "${role}"`);
	await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "dining" FROM "${role}"`);
}

async function grantDiningPrivileges(client: Client, role: DiningDatabaseRole): Promise<void> {
	await client.query(`GRANT USAGE ON SCHEMA "dining" TO "${role}"`);
	if (role === "app_api") {
		await client.query(`GRANT SELECT ON ${qualifiedTables(APP_API_READ_TABLES)} TO "app_api"`);
		return;
	}
	if (role === "ops_web_dining") {
		await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA "dining" TO "ops_web_dining"');
		await client.query(
			`GRANT INSERT, UPDATE, DELETE ON ${qualifiedTables(OPS_WEB_DINING_WRITE_TABLES)} TO "ops_web_dining"`,
		);
		return;
	}
	await client.query(
		`GRANT SELECT ON ${qualifiedTables(DINING_SYNC_READ_TABLES)} TO "dining_sync"`,
	);
	await client.query(
		`GRANT INSERT, UPDATE ON ${qualifiedTables(DINING_SYNC_WRITE_TABLES)} TO "dining_sync"`,
	);
}

async function verifyDiningPrivileges(client: Client, role: DiningDatabaseRole): Promise<void> {
	const schema = await client.query<{ canCreate: boolean; canUse: boolean }>(
		`select
			has_schema_privilege($1, 'dining', 'USAGE') as "canUse",
			has_schema_privilege($1, 'dining', 'CREATE') as "canCreate"`,
		[role],
	);
	if (schema.rows[0]?.canUse !== true || schema.rows[0]?.canCreate !== false) {
		throw new Error(`${role} must have USAGE but not CREATE on the dining schema.`);
	}

	const privileges = await client.query<DiningPrivilegeRow>(
		`select
			tablename as "tableName",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'SELECT') as "canSelect",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'INSERT') as "canInsert",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'UPDATE') as "canUpdate",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'DELETE') as "canDelete",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'TRUNCATE') as "canTruncate",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'REFERENCES') as "canReferences",
			has_table_privilege($1, format('%I.%I', 'dining', tablename), 'TRIGGER') as "canTrigger"
		from pg_catalog.pg_tables
		where schemaname = 'dining'
		order by tablename`,
		[role],
	);
	if (privileges.rows.length === 0) {
		throw new Error("dining schema has no tables to authorize.");
	}
	const presentTables = new Set(privileges.rows.map((privilege) => privilege.tableName));
	for (const table of EXPECTED_DINING_TABLES) {
		if (!presentTables.has(table)) {
			throw new Error(`dining.${table} is missing; complete the Dining migration first.`);
		}
	}

	for (const privilege of privileges.rows) {
		const expectedRead = role === "ops_web_dining" || readTables(role).has(privilege.tableName);
		const expectedWrite = writeTables(role).has(privilege.tableName);
		const expectedDelete = role === "ops_web_dining" && expectedWrite;
		if (
			privilege.canSelect !== expectedRead ||
			privilege.canInsert !== expectedWrite ||
			privilege.canUpdate !== expectedWrite ||
			privilege.canDelete !== expectedDelete ||
			privilege.canTruncate ||
			privilege.canReferences ||
			privilege.canTrigger
		) {
			throw new Error(`${role} has unexpected privileges on dining.${privilege.tableName}.`);
		}
	}
}

function readTables(role: DiningDatabaseRole): ReadonlySet<string> {
	if (role === "app_api") {
		return APP_API_READ_TABLES;
	}
	if (role === "dining_sync") {
		return DINING_SYNC_READ_TABLES;
	}
	return EMPTY_TABLES;
}

function writeTables(role: DiningDatabaseRole): ReadonlySet<string> {
	if (role === "ops_web_dining") {
		return OPS_WEB_DINING_WRITE_TABLES;
	}
	if (role === "dining_sync") {
		return DINING_SYNC_WRITE_TABLES;
	}
	return EMPTY_TABLES;
}

function qualifiedTables(tables: ReadonlySet<string>): string {
	return [...tables]
		.sort()
		.map((table) => `"dining"."${table}"`)
		.join(", ");
}
