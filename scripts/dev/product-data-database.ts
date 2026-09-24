import type { Client } from "pg";
import { createTransactionalIndexCatalog } from "../../jobs/campus-rag-index-publisher/src/catalog.ts";
import type { Sha256Ref } from "../../jobs/campus-rag-index-publisher/src/types.ts";
import {
	PRODUCT_DATA_TABLES,
	PRODUCT_RETRIEVAL_TABLES,
	type ProductDataRows,
	type ProductDataTable,
	productDataProjection,
	type RetrievalProductDataRows,
} from "./product-data-tables.ts";

const tables = Object.keys(PRODUCT_DATA_TABLES) as ProductDataTable[];

export async function exportProductData(client: Client): Promise<{
	rows: ProductDataRows;
	collection: string;
	docsEmbeddingSet: Sha256Ref;
	noticeEmbeddingSet: Sha256Ref;
}> {
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const rows = {} as ProductDataRows;
		for (const table of tables) {
			// PostgreSQL JSON preserves bigint/date representations independent of driver parsers.
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
			"select c.collection, v.docs_embedding_set, v.notice_embedding_set from campus_docs_serving.current_index c join campus_docs_serving.index_versions v using (collection) where singleton = true",
		);
		const collection = binding.rows[0]?.collection;
		if (!(collection && /^campus_docs_[a-f0-9]{64}$/u.test(collection))) {
			throw new Error("Product data has no valid current index");
		}
		await client.query("COMMIT");
		return {
			rows,
			collection,
			docsEmbeddingSet: binding.rows[0]?.docs_embedding_set,
			noticeEmbeddingSet: binding.rows[0]?.notice_embedding_set,
		};
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

export async function hasProductData(client: Client): Promise<boolean> {
	for (const table of tables) {
		const result = await client.query(`select 1 from ${table} limit 1`);
		if (result.rows.length > 0) {
			return true;
		}
	}
	return (
		(await client.query("select 1 from campus_docs_serving.current_index limit 1")).rows.length > 0
	);
}

export async function hasRetrievalData(client: Client): Promise<boolean> {
	for (const table of PRODUCT_RETRIEVAL_TABLES) {
		const result = await client.query(`select 1 from ${table} limit 1`);
		if (result.rows.length > 0) {
			return true;
		}
	}
	return (
		(await client.query("select 1 from campus_docs_serving.current_index limit 1")).rows.length > 0
	);
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
			"select c.collection, v.docs_embedding_set, v.notice_embedding_set from campus_docs_serving.current_index c join campus_docs_serving.index_versions v using (collection) where singleton = true",
		);
		const current = binding.rows[0];
		if (!(current?.collection && /^campus_docs_[a-f0-9]{64}$/u.test(current.collection))) {
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

/** Caller preflights resources and materializes the index before this transaction. */
export async function importProductData(
	client: Client,
	input: {
		rows: ProductDataRows;
		collection: string;
		docsEmbeddingSet: Sha256Ref;
		noticeEmbeddingSet: Sha256Ref;
		replace: boolean;
		localReviews?: Record<string, unknown>[];
	},
): Promise<void> {
	await client.query("BEGIN");
	try {
		// Serialize changes and prevent a writer from appearing between inventory and replacement.
		await client.query(
			`LOCK TABLE ${tables.join(", ")}, dining.reviews, dining.review_edits, dining.review_reports, campus_docs_serving.current_index IN ACCESS EXCLUSIVE MODE`,
		);
		if (!input.replace && (await hasProductData(client))) {
			throw new Error(
				"Local product data exists; use --replace to replace foundation data and dependent dining reviews",
			);
		}
		await client.query("delete from dining.review_reports");
		await client.query("delete from dining.review_edits");
		await client.query("delete from dining.reviews");
		for (const table of [...tables].reverse()) {
			await client.query(`delete from ${table}`);
		}
		for (const table of tables) {
			const columns = PRODUCT_DATA_TABLES[table];
			// One INSERT handles self-referencing release history in a single statement.
			await client.query(
				`insert into ${table} (${productDataProjection(table)}) select ${productDataProjection(table)} from json_populate_recordset(null::${table}, $1::json)`,
				[
					JSON.stringify(
						input.rows[table].map((row) =>
							Object.fromEntries(
								columns.map((column) => {
									if (!(column in row)) {
										throw new Error(`Missing product data column ${table}.${column}`);
									}
									return [column, row[column]];
								}),
							),
						),
					),
				],
			);
		}
		if (input.localReviews?.length) {
			await client.query(
				"insert into dining.reviews select * from json_populate_recordset(null::dining.reviews, $1::json)",
				[JSON.stringify(input.localReviews)],
			);
		}
		const catalog = createTransactionalIndexCatalog(client);
		await catalog.register({
			collection: input.collection,
			docsEmbeddingSet: input.docsEmbeddingSet,
			noticeEmbeddingSet: input.noticeEmbeddingSet,
			producer: "manual",
		});
		await catalog.markValidated(input.collection);
		await catalog.activate({ collection: input.collection });
		await client.query("COMMIT");
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
		const catalog = createTransactionalIndexCatalog(client);
		await catalog.register({
			collection: input.collection,
			docsEmbeddingSet: input.docsEmbeddingSet,
			noticeEmbeddingSet: input.noticeEmbeddingSet,
			producer: "manual",
		});
		await catalog.markValidated(input.collection);
		await catalog.activate({ collection: input.collection });
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

async function upsertRetrievalRows(
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
	await client.query(
		`insert into ${table} (${productDataProjection(table)})
		 select ${productDataProjection(table)} from json_populate_recordset(null::${table}, $1::json)
		 on conflict (${keys.map((key) => `"${key}"`).join(", ")}) do update set ${updates}`,
		[json],
	);
}

function serializeProductRows(
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
