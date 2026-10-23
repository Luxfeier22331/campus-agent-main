import type { Client } from "pg";
import type { NoticeSyncSelection } from "./notice-sync-options.ts";
import { serializeProductRows, upsertRetrievalRows } from "./product-data-database.ts";
import { PRODUCT_DATA_TABLES, productDataProjection } from "./product-data-tables.ts";

const NOTICE_SOURCE_KEYS = {
	"notices.categories": "category",
	"notices.notice_types": "notice_type",
	"notices.organizations": "organization_id",
	"notices.notices": "notice_id",
} as const;
type NoticeSourceTable = keyof typeof NOTICE_SOURCE_KEYS;
export type NoticeSourceRows = Record<NoticeSourceTable, Record<string, unknown>[]>;
const noticeColumns = [
	...PRODUCT_DATA_TABLES["notices.notices"],
	"source_ref",
	"published_source_ref",
];
const tables = Object.keys(NOTICE_SOURCE_KEYS) as NoticeSourceTable[];

export async function exportNoticeSources(
	client: Client,
	selection: NoticeSyncSelection | null = null,
): Promise<NoticeSourceRows> {
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const rows = {} as NoticeSourceRows;
		const noticeWhere = selection
			? "where released_at >= $1::timestamptz and released_at < $2::timestamptz"
			: "";
		const params = selection ? [selection.releasedFrom, selection.releasedTo] : [];
		for (const table of tables) {
			const key = NOTICE_SOURCE_KEYS[table];
			const filter =
				table === "notices.notices"
					? noticeWhere
					: `where "${key}" in (select "${key}" from notices.notices ${noticeWhere})`;
			const result = await client.query<{ row: Record<string, unknown> }>(
				`select row_to_json(projected) as row from
				 (select ${table === "notices.notices" ? noticeColumns.map((column) => (["source_ref", "published_source_ref"].includes(column) ? `"${column}"` : `"${column}"`)).join(", ") : productDataProjection(table)} from ${table} ${filter} order by "${key}") projected`,
				params,
			);
			rows[table] = result.rows.map(({ row }) => row);
		}
		await client.query("COMMIT");
		return rows;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

async function compareRows(client: Client, table: NoticeSourceTable, json: string) {
	const key = NOTICE_SOURCE_KEYS[table];
	const columns = table === "notices.notices" ? noticeColumns : PRODUCT_DATA_TABLES[table];
	const projection = (alias: string) => columns.map((column) => `${alias}."${column}"`).join(", ");
	const result = await client.query<{ missing: number; changed: number; unchanged: number }>(
		`with incoming as (select * from json_populate_recordset(null::${table}, $1::json))
		 select count(*) filter (where existing."${key}" is null)::int as missing,
		 count(*) filter (where existing."${key}" is not null and
		   row(${projection("existing")}) is distinct from row(${projection("incoming")}))::int as changed,
		 count(*) filter (where existing."${key}" is not null and
		   row(${projection("existing")}) is not distinct from row(${projection("incoming")}))::int as unchanged
		 from incoming left join ${table} existing using ("${key}")`,
		[json],
	);
	return result.rows[0];
}

export async function importNoticeSources(
	client: Client,
	rows: NoticeSourceRows,
	options: { withSources?: boolean } = {},
) {
	const incomingRows: NoticeSourceRows = options.withSources
		? rows
		: {
				...rows,
				"notices.notices": rows["notices.notices"].map((row) => ({
					...row,
					source_ref: null,
					published_source_ref: null,
				})),
			};
	const encoded = Object.fromEntries(
		tables.map((table) => [
			table,
			table === "notices.notices"
				? JSON.stringify(
						incomingRows[table].map((row) =>
							Object.fromEntries(noticeColumns.map((column) => [column, row[column] ?? null])),
						),
					)
				: serializeProductRows(table, incomingRows[table]),
		]),
	) as Record<NoticeSourceTable, string>;
	await client.query("BEGIN");
	try {
		// Serialize notice writers while allowing applications to read the previous committed data.
		await client.query(`LOCK TABLE ${tables.join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
		const before = await compareRows(client, "notices.notices", encoded["notices.notices"]);
		for (const table of tables) {
			if (table === "notices.notices") {
				const columns = noticeColumns.map((column) => `"${column}"`).join(", ");
				await client.query(
					`INSERT INTO notices.notices (${columns}) SELECT ${columns} FROM json_populate_recordset(null::notices.notices, $1::json) ON CONFLICT (notice_id) DO UPDATE SET ${noticeColumns
						.filter((column) => column !== "notice_id")
						.map((column) => `"${column}"=EXCLUDED."${column}"`)
						.join(", ")}`,
					[encoded[table]],
				);
			} else {
				await upsertRetrievalRows(client, table, encoded[table], [NOTICE_SOURCE_KEYS[table]]);
			}
		}
		for (const table of tables) {
			const checked = await compareRows(client, table, encoded[table]);
			if (checked.missing || checked.changed) {
				throw new Error(`Notice sync verification failed: ${table}`);
			}
		}
		const extras = await client.query<{ notice_id: string; chunk_eligible: boolean }>(
			`select notice_id::text, (is_published and content_text is not null) as chunk_eligible
			 from notices.notices where notice_id not in
			 (select notice_id from json_populate_recordset(null::notices.notices, $1::json)) order by notice_id`,
			[encoded["notices.notices"]],
		);
		await client.query("COMMIT");
		return {
			source_notices: rows["notices.notices"].length,
			source_chunk_eligible: rows["notices.notices"].filter(
				(row) => row.is_published && row.content_text !== null,
			).length,
			inserted: before.missing,
			updated: before.changed,
			unchanged: before.unchanged,
			mismatched: 0,
			related_rows: Object.fromEntries(
				tables
					.filter((table) => table !== "notices.notices")
					.map((table) => [table, rows[table].length]),
			),
			local_extra_count: extras.rows.length,
			local_extra_chunk_eligible: extras.rows.filter((row) => row.chunk_eligible).length,
			local_extra_ids: extras.rows.map((row) => row.notice_id),
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}
