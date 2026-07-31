import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Client } from "pg";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const PRE_DRIZZLE_COLUMNS = {
	map_draft: ["bundle_json", "fingerprint", "revision", "scope", "updated_at", "updated_by"],
	map_publication: ["release_id", "scope", "updated_at", "updated_by"],
	map_releases: [
		"bundle_json",
		"created_at",
		"created_by",
		"draft_revision",
		"kind",
		"public_payload_json",
		"release_id",
		"restored_from_release_id",
		"snapshot_hash",
	],
	menu_items: [
		"archived_at",
		"created_at",
		"created_by",
		"menu_item_id",
		"name",
		"price_text",
		"sort_order",
		"updated_at",
		"updated_by",
		"window_id",
	],
	review_edits: ["edit_id", "edited_at", "edited_by", "next_body", "previous_body", "review_id"],
	review_reports: [
		"created_at",
		"details",
		"reason",
		"report_id",
		"reporter_user_id",
		"resolution",
		"resolved_at",
		"resolved_by",
		"review_id",
	],
	reviews: [
		"anonymous",
		"author_display_name",
		"author_id",
		"author_kind",
		"body",
		"created_at",
		"deleted_at",
		"deleted_by",
		"edited_at",
		"hidden_at",
		"hidden_by",
		"idempotency_key",
		"menu_item_id",
		"review_id",
		"submission_date",
		"updated_at",
		"updated_by",
	],
} as const;

const PRE_DRIZZLE_CONSTRAINT_COUNTS = {
	map_draft: [10],
	map_publication: [7],
	map_releases: [13],
	menu_items: [12],
	review_edits: [8],
	review_reports: [11, 12],
	reviews: [16],
} as const;

const PRE_DRIZZLE_INDEXES = [
	"dining_map_releases_created_idx",
	"dining_menu_items_window_sort_idx",
	"dining_review_edits_review_idx",
	"dining_review_reports_pending_idx",
	"dining_reviews_idempotency_uidx",
	"dining_reviews_member_limit_idx",
	"dining_reviews_menu_created_idx",
] as const;

async function hasMigrationLedger(client: Client): Promise<boolean> {
	const result = await client.query<{ present: boolean }>(
		`select to_regclass('drizzle.ops_web_dining_migrations') is not null as present`,
	);
	return result.rows[0]?.present === true;
}

async function hasDiningObjects(client: Client): Promise<boolean> {
	const result = await client.query<{ present: boolean }>(`
		select to_regnamespace('dining') is not null as present
	`);
	return result.rows[0]?.present === true;
}

async function preDrizzleSchemaMismatch(client: Client): Promise<string | undefined> {
	const columns = await client.query<{ column_name: string; table_name: string }>(`
		select table_name, column_name
		from information_schema.columns
		where table_schema = 'dining'
		order by table_name collate "C", column_name collate "C"
	`);
	const actualColumns = new Map<string, string[]>();
	for (const row of columns.rows) {
		const values = actualColumns.get(row.table_name) ?? [];
		values.push(row.column_name);
		actualColumns.set(row.table_name, values);
	}
	if (
		actualColumns.size !== Object.keys(PRE_DRIZZLE_COLUMNS).length ||
		!Object.entries(PRE_DRIZZLE_COLUMNS).every(
			([table, expected]) => actualColumns.get(table)?.join(",") === expected.join(","),
		)
	) {
		return `columns=${JSON.stringify(Object.fromEntries(actualColumns))}`;
	}

	const constraints = await client.query<{ count: number; table_name: string }>(`
		select table_name, count(*)::int as count
		from information_schema.table_constraints
		where table_schema = 'dining'
		group by table_name
		order by table_name collate "C"
	`);
	const actualConstraintCounts = new Map(
		constraints.rows.map((row) => [row.table_name, row.count]),
	);
	if (
		actualConstraintCounts.size !== Object.keys(PRE_DRIZZLE_CONSTRAINT_COUNTS).length ||
		!Object.entries(PRE_DRIZZLE_CONSTRAINT_COUNTS).every(([table, counts]) =>
			(counts as readonly number[]).includes(actualConstraintCounts.get(table) ?? -1),
		)
	) {
		return `constraints=${JSON.stringify(Object.fromEntries(actualConstraintCounts))}`;
	}

	const indexes = await client.query<{ indexname: string }>(
		`
		select indexname
		from pg_indexes
		where schemaname = 'dining' and indexname = any($1::text[])
		order by indexname collate "C"
	`,
		[PRE_DRIZZLE_INDEXES],
	);
	const actualIndexes = indexes.rows.map((row) => row.indexname);
	if (actualIndexes.join(",") !== PRE_DRIZZLE_INDEXES.join(",")) {
		return `indexes=${actualIndexes.join(",") || "none"}`;
	}
	return;
}

async function preparePreDrizzleBaseline(client: Client): Promise<void> {
	if (await hasMigrationLedger(client)) {
		return;
	}
	if (!(await hasDiningObjects(client))) {
		return;
	}
	const mismatch = await preDrizzleSchemaMismatch(client);
	if (mismatch) {
		throw new Error(
			`Dining schema has owned objects without drizzle.ops_web_dining_migrations; refusing an unknown partial bootstrap (${mismatch}).`,
		);
	}
	const [initialMigration] = readMigrationFiles({ migrationsFolder });
	if (!initialMigration) {
		throw new Error("Ops Web Dining initial migration is missing.");
	}
	await client.query("begin");
	try {
		await client.query("create schema if not exists drizzle");
		await client.query(`
			create table if not exists drizzle.ops_web_dining_migrations (
				id serial primary key,
				hash text not null,
				created_at bigint
			)
		`);
		await client.query(
			"insert into drizzle.ops_web_dining_migrations (hash, created_at) values ($1, $2)",
			[initialMigration.hash, initialMigration.folderMillis],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

async function verifyAppliedMigrationHashes(client: Client): Promise<void> {
	if (!(await hasMigrationLedger(client))) {
		return;
	}
	const expected = new Map(
		readMigrationFiles({ migrationsFolder }).map((migration) => [
			String(migration.folderMillis),
			migration.hash,
		]),
	);
	const applied = await client.query<{ created_at: string; hash: string }>(`
		select created_at::text, hash
		from drizzle.ops_web_dining_migrations
		order by created_at, id
	`);
	for (const migration of applied.rows) {
		const expectedHash = expected.get(migration.created_at);
		if (!expectedHash) {
			throw new Error(
				`Database contains an unknown Ops Web Dining migration created_at=${migration.created_at}.`,
			);
		}
		if (expectedHash !== migration.hash) {
			throw new Error(
				`Ops Web Dining migration was modified after apply: created_at=${migration.created_at}.`,
			);
		}
	}
}

export async function migrateDiningSchema(client: Client): Promise<void> {
	await preparePreDrizzleBaseline(client);
	await verifyAppliedMigrationHashes(client);
	await migrate(drizzle(client), {
		migrationsFolder,
		migrationsSchema: "drizzle",
		migrationsTable: "ops_web_dining_migrations",
	});
}
