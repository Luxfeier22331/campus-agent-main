import type { Client } from "pg";
import { createTransactionalIndexCatalog } from "../../jobs/campus-rag-index-publisher/src/catalog.ts";
import {
	PRODUCT_DATA_TABLES,
	type ProductDataRows,
	type ProductDataTable,
	productDataProjection,
} from "./product-data-tables.ts";

const tables = Object.keys(PRODUCT_DATA_TABLES) as ProductDataTable[];

export async function exportProductData(
	client: Client,
): Promise<{ rows: ProductDataRows; collection: string }> {
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
		const binding = await client.query<{ collection: string }>(
			"select collection from campus_docs_serving.current_index where singleton = true",
		);
		const collection = binding.rows[0]?.collection;
		if (!(collection && /^campus_docs_[a-f0-9]{64}$/u.test(collection))) {
			throw new Error("Product data has no valid current index");
		}
		await client.query("COMMIT");
		return { rows, collection };
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

/** Caller preflights resources and materializes the index before this transaction. */
export async function importProductData(
	client: Client,
	input: {
		rows: ProductDataRows;
		collection: string;
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
		await createTransactionalIndexCatalog(client).activate({ collection: input.collection });
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}
