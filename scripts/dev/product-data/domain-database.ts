import type { Client } from "pg";
import {
	PRODUCT_DATA_TABLES,
	type ProductDataRows,
	type ProductDataTable,
} from "./product-data-tables.ts";
export const BUSINESS_DOMAINS = ["notices", "groups", "dining", "transport"] as const;
export type BusinessDomain = (typeof BUSINESS_DOMAINS)[number];
export const DOMAIN_TABLES: Record<BusinessDomain, ProductDataTable[]> = {
	notices: Object.keys(PRODUCT_DATA_TABLES).filter((t) =>
		t.startsWith("notices."),
	) as ProductDataTable[],
	groups: ["campus_groups.sections", "campus_groups.groups"],
	dining: [
		"dining.map_draft",
		"dining.map_releases",
		"dining.map_publication",
		"dining.menu_items",
	],
	transport: Object.keys(PRODUCT_DATA_TABLES).filter((t) =>
		t.startsWith("transport."),
	) as ProductDataTable[],
};
function domainColumns(table: ProductDataTable): readonly string[] {
	return table === "notices.notices"
		? [...PRODUCT_DATA_TABLES[table], "source_ref", "published_source_ref"]
		: PRODUCT_DATA_TABLES[table];
}
function domainProjection(table: ProductDataTable) {
	return domainColumns(table)
		.map((column) => `"${column}"`)
		.join(", ");
}
export async function domainHasData(client: Client, domain: BusinessDomain) {
	const tables = domain === "notices" ? ["notices.notices"] : DOMAIN_TABLES[domain];
	for (const table of tables) {
		if ((await client.query(`select 1 from ${table} limit 1`)).rows.length > 0) {
			return true;
		}
	}
	return false;
}
export async function readDomainRows(
	client: Client,
	domains: readonly BusinessDomain[],
): Promise<ProductDataRows> {
	const rows = Object.fromEntries(
		Object.keys(PRODUCT_DATA_TABLES).map((t) => [t, []]),
	) as unknown as ProductDataRows;
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		for (const table of domains.flatMap((d) => DOMAIN_TABLES[d])) {
			rows[table] = (
				await client.query<{ row: Record<string, unknown> }>(
					`select row_to_json(projected) as row from (select ${domainProjection(table)} from ${table}) projected`,
				)
			).rows.map((r) => r.row);
		}
		await client.query("COMMIT");
		return rows;
	} catch (e) {
		await client.query("ROLLBACK");
		throw e;
	}
}
export async function applyDomainRows(
	client: Client,
	domains: readonly BusinessDomain[],
	rows: ProductDataRows,
	replace: boolean,
	reviews?: Record<string, unknown>[],
) {
	if (domains.length === 0) {
		return [];
	}
	const allTables = Object.keys(PRODUCT_DATA_TABLES) as ProductDataTable[];
	await client.query("BEGIN");
	try {
		const requested = new Set(domains.flatMap((d) => DOMAIN_TABLES[d]));
		await client.query(
			`LOCK TABLE ${allTables.filter((t) => requested.has(t)).join(", ")} IN ACCESS EXCLUSIVE MODE`,
		);
		const selected: BusinessDomain[] = [];
		for (const domain of domains) {
			if (replace || !(await domainHasData(client, domain))) {
				selected.push(domain);
			}
		}
		if (
			replace &&
			selected.includes("notices") &&
			!selected.includes("transport") &&
			(await client.query("select 1 from transport.schedule_period_notices limit 1")).rows.length >
				0
		) {
			throw new Error(
				"Replacing notices would remove transport references; explicitly select transport too.",
			);
		}
		if (selected.includes("transport")) {
			const incoming = new Set(rows["notices.notices"].map((row) => String(row.notice_id)));
			for (const link of rows["transport.schedule_period_notices"]) {
				if (selected.includes("notices") && incoming.has(String(link.notice_id))) {
					continue;
				}
				if (
					selected.includes("notices") ||
					(
						await client.query("select 1 from notices.notices where notice_id = $1", [
							link.notice_id,
						])
					).rows.length === 0
				) {
					throw new Error(
						`Transport references missing notice ${link.notice_id}; sync notices first or select both domains.`,
					);
				}
			}
		}
		const tables = allTables.filter((t) => selected.some((d) => DOMAIN_TABLES[d].includes(t)));
		if (selected.includes("dining") && replace) {
			await client.query("delete from dining.review_reports");
			await client.query("delete from dining.review_edits");
			await client.query("delete from dining.reviews");
		}
		if (replace) {
			for (const table of [...tables].reverse()) {
				await client.query(`delete from ${table}`);
			}
		}
		for (const table of tables) {
			const columns = domainColumns(table);
			await client.query(
				`insert into ${table} (${domainProjection(table)}) select ${domainProjection(table)} from json_populate_recordset(null::${table}, $1::json) ${!replace && ["notices.categories", "notices.notice_types", "notices.organizations"].includes(table) ? "on conflict do nothing" : ""}`,
				[
					JSON.stringify(
						rows[table].map((row) =>
							Object.fromEntries(columns.map((col) => [col, row[col] ?? null])),
						),
					),
				],
			);
		}
		if (selected.includes("dining") && reviews?.length) {
			await client.query(
				"insert into dining.reviews select * from json_populate_recordset(null::dining.reviews, $1::json)",
				[JSON.stringify(reviews)],
			);
		}
		if (replace && selected.includes("notices")) {
			await client.query("delete from campus_docs_serving.current_index");
		}
		await client.query("COMMIT");
		return selected;
	} catch (e) {
		await client.query("ROLLBACK");
		throw e;
	}
}
