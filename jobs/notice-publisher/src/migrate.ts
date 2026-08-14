import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

const MIGRATIONS = [
	{
		path: fileURLToPath(new URL("../migrations/0001_notices.sql", import.meta.url)),
		version: 1,
	},
	{
		path: fileURLToPath(
			new URL("../migrations/0002_app_api_notice_read.sql", import.meta.url),
		),
		version: 2,
	},
	{
		path: fileURLToPath(
			new URL("../migrations/0003_external_notice_content.sql", import.meta.url),
		),
		version: 3,
	},
	{
		path: fileURLToPath(
			new URL("../migrations/0004_notice_asset_portal_annex_id.sql", import.meta.url),
		),
		version: 4,
	},
] as const;

const REQUIRED_TABLES = [
	"notices.schema_migrations",
	"notices.notice_types",
	"notices.organizations",
	"notices.domains",
	"notices.notices",
	"notices.notice_assets",
] as const;

export async function migrateNotices(client: PoolClient): Promise<"applied" | "current"> {
	const existing = await client.query(
		`SELECT
			to_regnamespace('notices') AS schema,
			${REQUIRED_TABLES.map((table, index) => `to_regclass('${table}') AS table_${index}`).join(",\n\t\t\t")}`,
	);
	const row = existing.rows[0] as Record<string, string | null>;
	const schemaExists = row.schema !== null;
	const tablesExist = REQUIRED_TABLES.map((_, index) => row[`table_${index}`] !== null);
	if (schemaExists && !tablesExist[0]) {
		throw new Error("notices schema exists without its migration ledger");
	}
	if (!schemaExists && tablesExist.some(Boolean)) {
		throw new Error("notices tables exist without their schema");
	}
	if (tablesExist[0] && tablesExist.some((exists) => !exists)) {
		throw new Error("notices schema migration state is unsupported");
	}

	let versions: number[] = [];
	if (tablesExist[0]) {
		const result = await client.query(
			"SELECT version FROM notices.schema_migrations ORDER BY version",
		);
		versions = result.rows.map((item) => Number(item.version));
		if (
			!(
				JSON.stringify(versions) === "[1]" ||
				JSON.stringify(versions) === "[1,2]" ||
				JSON.stringify(versions) === "[1,2,3]" ||
				JSON.stringify(versions) === "[1,2,3,4]"
			)
		) {
			throw new Error("notices schema migration state is unsupported");
		}
	}

	const pending = MIGRATIONS.filter((migration) => !versions.includes(migration.version));
	if (pending.length === 0) {
		await verifyAppApiNoticeReadAccess(client);
		return "current";
	}

	await client.query("BEGIN");
	try {
		for (const migration of pending) {
			await client.query(await readFile(migration.path, "utf8"));
		}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
	await verifyAppApiNoticeReadAccess(client);
	return "applied";
}

async function verifyAppApiNoticeReadAccess(client: PoolClient): Promise<void> {
	const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'app_api'");
	if (role.rowCount !== 1) {
		throw new Error("app_api database role is missing");
	}
	const result = await client.query(`SELECT
		has_schema_privilege('app_api', 'notices', 'USAGE') AS can_use_schema,
		has_table_privilege('app_api', 'notices.schema_migrations', 'SELECT') AS can_read_ledger,
		has_table_privilege('app_api', 'notices.notices', 'SELECT') AS can_read_notices,
		has_table_privilege('app_api', 'notices.notice_assets', 'SELECT') AS can_read_assets,
		has_table_privilege('app_api', 'notices.notice_types', 'SELECT') AS can_read_types,
		has_table_privilege('app_api', 'notices.organizations', 'SELECT') AS can_read_organizations,
		has_table_privilege('app_api', 'notices.domains', 'SELECT') AS can_read_domains,
		has_table_privilege('app_api', 'notices.notices', 'INSERT,UPDATE,DELETE') AS can_write_notices,
		has_table_privilege('app_api', 'notices.notice_assets', 'INSERT,UPDATE,DELETE') AS can_write_assets`);
	const access = result.rows[0] as Record<string, boolean>;
	if (
		!access.can_use_schema ||
		access.can_read_ledger ||
		!access.can_read_notices ||
		!access.can_read_assets ||
		!access.can_read_types ||
		!access.can_read_organizations ||
		!access.can_read_domains ||
		access.can_write_notices ||
		access.can_write_assets
	) {
		throw new Error("app_api notice privileges do not match the read-only contract");
	}
}
