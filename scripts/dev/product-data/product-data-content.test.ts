import assert from "node:assert/strict";
import test from "node:test";
import { copyNoticeSources, exportProductContent } from "./product-data-content.ts";
import { importProductContent } from "./product-data-database.ts";
import { parseProductDataOptions } from "./product-data-options.ts";
import { PRODUCT_DATA_TABLES, type ProductDataRows } from "./product-data-tables.ts";

function emptyRows() {
	return Object.fromEntries(
		Object.keys(PRODUCT_DATA_TABLES).map((table) => [table, []]),
	) as ProductDataRows;
}

test("content mode defaults to 100 recent notices and rejects limits on full retrieval sync", () => {
	assert.equal(parseProductDataOptions(["--data", "cluster-content"]).noticeLimit, 100);
	assert.equal(
		parseProductDataOptions(["--data", "cluster-content", "--notice-limit", "20"]).noticeLimit,
		20,
	);
	for (const value of ["0", "-1", "1.5", "many"]) {
		assert.throws(
			() => parseProductDataOptions(["--data", "cluster-content", "--notice-limit", value]),
			/positive integer/u,
		);
	}
	assert.throws(
		() => parseProductDataOptions(["--data", "cluster", "--notice-limit", "20"]),
		/cluster-content/u,
	);
});

test("notice and asset exports share the recent and transport-linked ID selection", async () => {
	const statements: string[] = [];
	const selected = ["101", "4"];
	let sampled = 0;
	await exportProductContent(
		{
			async query(sql: string, args: unknown[]) {
				statements.push(sql);
				if (sql.includes("limit $1")) {
					assert.deepEqual(args, [1]);
					assert.match(sql, /union select notice_id from transport.schedule_period_notices/u);
					return { rows: selected.map((notice_id) => ({ notice_id })) };
				}
				if (sql.includes("any($1::bigint[])")) {
					assert.deepEqual(args, [selected]);
					sampled++;
				}
				return { rows: [] };
			},
		} as never,
		1,
	);
	assert.equal(sampled, 2);
	assert.equal(statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	assert.equal(statements.at(-1), "COMMIT");
});

test("copies only source JSON, retaining resource metadata without downloading binary objects", async () => {
	const rows = emptyRows();
	rows["notices.notices"] = [{ notice_id: 101 }];
	rows["notices.notice_assets"] = [{ notice_id: 101, asset_kind: "image" }];
	const source = {
		schema_version: "internal_portal_notice_source.v2",
		notice_id: 101,
		notice_type: 5,
		organization_id: null,
		notice_title: "通知",
		notice_release_time: "2026-09-15 08:00:00",
		is_external: false,
		external_url: null,
		notice_content_html: '<p>正文</p><img src="https://example.com/photo.jpg">',
		attachments: [
			{
				notice_annex_id: "1",
				notice_annex_name: "安排.pdf",
				notice_annex_path: "/1.pdf",
				suffix: "pdf",
				type: null,
			},
		],
	};
	const body = Buffer.from(JSON.stringify(source));
	const keys: string[] = [];
	const bytes = await copyNoticeSources(
		rows,
		{
			async read(key) {
				keys.push(key);
				return body;
			},
		},
		async (key, value) => {
			assert.equal(key, "internal_portal/notices/101.json");
			assert.deepEqual(value, body);
		},
	);
	assert.deepEqual(keys, ["internal_portal/notices/101.json"]);
	assert.equal(bytes, body.length);
});

test("content replacement clears the stale index in the same transaction and rolls back on row failure", async () => {
	for (const fail of [false, true]) {
		const statements: string[] = [];
		const run = importProductContent(
			{
				async query(sql: string) {
					statements.push(sql);
					if (fail && sql.startsWith("insert into transport.routes")) {
						throw new Error("invalid route");
					}
					return { rows: [] };
				},
			} as never,
			{ rows: emptyRows(), replace: true },
		);
		if (fail) {
			await assert.rejects(run, /invalid route/u);
			assert.equal(statements.at(-1), "ROLLBACK");
			assert(!statements.includes("delete from campus_docs_serving.current_index"));
		} else {
			await run;
			assert.deepEqual(statements.slice(-2), [
				"delete from campus_docs_serving.current_index",
				"COMMIT",
			]);
		}
	}
});
