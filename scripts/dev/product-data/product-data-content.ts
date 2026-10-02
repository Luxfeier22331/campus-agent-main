import { validateInternalPortalNoticeSource } from "ingestion-contracts";
import type { Client } from "pg";
import type { ReaderObjectStore } from "../../../jobs/campus-rag-index-publisher/src/types.ts";
import {
	PRODUCT_DATA_TABLES,
	type ProductDataRows,
	type ProductDataTable,
	productDataProjection,
} from "./product-data-tables.ts";

/** Recent notices plus the notices referenced by the transport data being imported. */
export async function exportProductContent(
	client: Client,
	noticeLimit: number,
): Promise<ProductDataRows> {
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const selected = await client.query<{ notice_id: string }>(
			`select notice_id::text from (
				(select notice_id from notices.notices order by released_at desc, notice_id desc limit $1)
				union select notice_id from transport.schedule_period_notices
			) selected`,
			[noticeLimit],
		);
		const ids = selected.rows.map((row) => row.notice_id);
		const rows = {} as ProductDataRows;
		for (const table of Object.keys(PRODUCT_DATA_TABLES) as ProductDataTable[]) {
			const sampled = table === "notices.notices" || table === "notices.notice_assets";
			const result = await client.query<{ row: Record<string, unknown> }>(
				`select row_to_json(projected) as row from (
					select ${productDataProjection(table)}${table === "notices.notices" ? ", source_ref" : ""} from ${table}
					${sampled ? "where notice_id = any($1::bigint[])" : ""}
				) projected`,
				sampled ? [ids] : [],
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

/** Ops preview requires source JSON; image and attachment objects are intentionally excluded. */
export async function copyNoticeSources(
	rows: ProductDataRows,
	source: ReaderObjectStore,
	write: (key: string, bytes: Uint8Array) => Promise<void>,
) {
	let bytes = 0;
	for (const notice of rows["notices.notices"]) {
		const key = `internal_portal/notices/${notice.notice_id}.json`;
		const body = await source.read(typeof notice.source_ref === "string" ? notice.source_ref : key);
		const value = JSON.parse(Buffer.from(body).toString("utf8"));
		if (
			!validateInternalPortalNoticeSource(value).ok ||
			String(value.notice_id) !== String(notice.notice_id)
		) {
			throw new Error(`Invalid notice source: ${key}`);
		}
		await write(key, body);
		bytes += body.byteLength;
	}
	return bytes;
}
