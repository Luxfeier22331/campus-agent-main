import type { Client } from "pg";
import { bindingCollection, writeCurrentIndex } from "../../../jobs/retrieval-index/src/catalog.ts";
import type { Sha256Ref } from "../../../jobs/retrieval-index/src/types.ts";
import {
	PRODUCT_DATA_TABLES,
	PRODUCT_RETRIEVAL_TABLES,
	productDataProjection,
	type RetrievalProductDataRows,
} from "./product-data-tables.ts";

/** Keep the source index and its artifact closure stable until remote reads finish. */
export async function withRetrievalExportLock<T>(
	client: Client,
	read: () => Promise<T>,
): Promise<T> {
	await client.query("SELECT pg_advisory_lock_shared(hashtext('campus_rag_index_publish'))");
	try {
		return await read();
	} finally {
		await client.query("SELECT pg_advisory_unlock_shared(hashtext('campus_rag_index_publish'))");
	}
}

export async function exportRetrievalData(client: Client): Promise<{
	rows: RetrievalProductDataRows;
	collection: string;
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
}> {
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const rows = {} as RetrievalProductDataRows;
		for (const table of PRODUCT_RETRIEVAL_TABLES) {
			const result = await client.query<{ row: Record<string, unknown> }>(
				`select row_to_json(projected) as row from (select ${productDataProjection(table)} from ${table}) projected`,
			);
			rows[table] = result.rows.map(({ row }) => row);
		}
		const binding = await client.query<{
			collection: string;
			docs_embedding_set: Sha256Ref;
			notice_embedding_set: Sha256Ref;
		}>(
			"select collection, docs_embedding_set, notice_embedding_set from campus_docs_serving.current_index where singleton = true",
		);
		const current = binding.rows[0];
		if (
			!(
				current?.docs_embedding_set &&
				current.notice_embedding_set &&
				current.collection ===
					bindingCollection({
						docsEmbeddingSet: current.docs_embedding_set,
						noticeEmbeddingSet: current.notice_embedding_set,
					})
			)
		) {
			throw new Error("Product data has no valid current index");
		}
		await client.query("COMMIT");
		return {
			rows,
			collection: current.collection,
			docsEmbeddingSet: current.docs_embedding_set,
			noticeEmbeddingSet: current.notice_embedding_set,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

/** Import only the notice rows required by a serving index and keep all local user/business state. */
export async function importRetrievalData(
	client: Client,
	input: {
		rows: RetrievalProductDataRows;
		collection: string;
		docsEmbeddingSet: Sha256Ref;
		noticeEmbeddingSet: Sha256Ref;
	},
): Promise<void> {
	const retrievalTables = PRODUCT_RETRIEVAL_TABLES;
	await client.query("BEGIN");
	try {
		await client.query(
			`LOCK TABLE ${retrievalTables.join(", ")}, transport.schedule_period_notices, notices.processing_failures, campus_docs_serving.current_index IN ACCESS EXCLUSIVE MODE`,
		);
		const rows = Object.fromEntries(
			retrievalTables.map((table) => [table, serializeProductRows(table, input.rows[table])]),
		) as Record<(typeof retrievalTables)[number], string>;

		await client.query(
			`delete from notices.notices notice
			 where not exists (
				 select 1 from json_populate_recordset(null::notices.notices, $1::json) incoming
				 where incoming.notice_id = notice.notice_id
			 )
			 and not exists (
				 select 1 from transport.schedule_period_notices link
				 where link.notice_id = notice.notice_id
			 )
			 and not exists (
				 select 1 from notices.processing_failures failure
				 where failure.notice_id = notice.notice_id
			 )`,
			[rows["notices.notices"]],
		);

		await upsertRetrievalRows(client, "notices.categories", rows["notices.categories"], [
			"category",
		]);
		await upsertRetrievalRows(client, "notices.notice_types", rows["notices.notice_types"], [
			"notice_type",
		]);
		await upsertRetrievalRows(client, "notices.organizations", rows["notices.organizations"], [
			"organization_id",
		]);
		await upsertRetrievalRows(client, "notices.notices", rows["notices.notices"], ["notice_id"]);
		await client.query(
			`delete from notices.notice_assets asset
			 using json_populate_recordset(null::notices.notices, $1::json) incoming
			 where asset.notice_id = incoming.notice_id`,
			[rows["notices.notices"]],
		);
		await upsertRetrievalRows(client, "notices.notice_assets", rows["notices.notice_assets"], [
			"notice_id",
			"asset_kind",
			"ordinal",
		]);

		await client.query(
			`delete from notices.categories category
			 where not exists (
				 select 1 from json_populate_recordset(null::notices.categories, $1::json) incoming
				 where incoming.category = category.category
			 )
			 and not exists (select 1 from notices.notices notice where notice.category = category.category)`,
			[rows["notices.categories"]],
		);
		await client.query(
			`delete from notices.notice_types notice_type
			 where not exists (
				 select 1 from json_populate_recordset(null::notices.notice_types, $1::json) incoming
				 where incoming.notice_type = notice_type.notice_type
			 )
			 and not exists (select 1 from notices.notices notice where notice.notice_type = notice_type.notice_type)`,
			[rows["notices.notice_types"]],
		);
		await client.query(
			`delete from notices.organizations organization
			 where not exists (
				 select 1 from json_populate_recordset(null::notices.organizations, $1::json) incoming
				 where incoming.organization_id = organization.organization_id
			 )
			 and not exists (select 1 from notices.notices notice where notice.organization_id = organization.organization_id)`,
			[rows["notices.organizations"]],
		);
		await writeCurrentIndex(client, input);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

export async function upsertRetrievalRows(
	client: Client,
	table: (typeof PRODUCT_RETRIEVAL_TABLES)[number],
	json: string,
	keys: readonly string[],
): Promise<void> {
	const columns = PRODUCT_DATA_TABLES[table];
	const updates = columns
		.filter((column) => !keys.includes(column))
		.map((column) => `"${column}" = excluded."${column}"`)
		.join(", ");
	const conflictAction = updates ? `do update set ${updates}` : "do nothing";
	await client.query(
		`insert into ${table} (${productDataProjection(table)})
		 select ${productDataProjection(table)} from json_populate_recordset(null::${table}, $1::json)
		 on conflict (${keys.map((key) => `"${key}"`).join(", ")}) ${conflictAction}`,
		[json],
	);
}

export function serializeProductRows(
	table: (typeof PRODUCT_RETRIEVAL_TABLES)[number],
	rows: Record<string, unknown>[],
): string {
	const columns = PRODUCT_DATA_TABLES[table];
	return JSON.stringify(
		rows.map((row) =>
			Object.fromEntries(
				columns.map((column) => {
					if (!(column in row)) {
						throw new Error(`Missing product data column ${table}.${column}`);
					}
					return [column, row[column]];
				}),
			),
		),
	);
}

export async function readRetrievalRows(client: Client): Promise<RetrievalProductDataRows> {
	const rows = {} as RetrievalProductDataRows;
	for (const table of PRODUCT_RETRIEVAL_TABLES) {
		rows[table] = (
			await client.query<{ row: Record<string, unknown> }>(
				`select row_to_json(projected) as row from (select ${productDataProjection(table)} from ${table}) projected`,
			)
		).rows.map((r) => r.row);
	}
	return rows;
}
export async function activateRetrievalIndex(
	client: Client,
	input: { collection: string; docsEmbeddingSet: Sha256Ref; noticeEmbeddingSet: Sha256Ref },
) {
	await client.query("BEGIN");
	try {
		await writeCurrentIndex(client, input);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}
