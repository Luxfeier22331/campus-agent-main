import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "pg";
import { exportNoticeSources, importNoticeSources, type NoticeSourceRows } from "./notice-sync.ts";
import { parseNoticeSyncSelection } from "./notice-sync-options.ts";

// Use an empty, disposable database: the test owns only the schema it creates.
test("notice-only sync preserves local records, verifies updates and rolls back invalid relations", {
	skip: !process.env.NOTICE_SYNC_TEST_DATABASE_URL,
}, async () => {
	const client = new Client({ connectionString: process.env.NOTICE_SYNC_TEST_DATABASE_URL });
	await client.connect();
	let created = false;
	try {
		await client.query("CREATE SCHEMA notices");
		created = true;
		const migration = await readFile(
			resolve(
				import.meta.dirname,
				"../../../jobs/campus-agent-schema/migrations/20260827151741_0000_campus_agent_baseline/migration.sql",
			),
			"utf8",
		);
		const tables = "(?:categories|notice_types|organizations|notices)";
		const creates =
			migration.match(new RegExp(`CREATE TABLE notices\\.${tables} \\([\\s\\S]*?\\n\\);`, "g")) ??
			[];
		const constraints =
			migration.match(
				new RegExp(`ALTER TABLE ONLY notices\\.${tables}\\n\\s+ADD CONSTRAINT [^;]+;`, "g"),
			) ?? [];
		assert.equal(creates.length, 4);
		for (const sql of [...creates, ...constraints]) {
			await client.query(sql);
		}
		await client.query(
			"ALTER TABLE notices.notices ADD COLUMN source_ref text, ADD COLUMN published_source_ref text",
		);
		const rows: NoticeSourceRows = {
			"notices.categories": [{ category: "交流" }],
			"notices.notice_types": [{ notice_type: 1, name: "通知" }],
			"notices.organizations": [{ organization_id: "international", name: "国际交流处" }],
			"notices.notices": [
				{
					notice_id: 355214,
					notice_type: 1,
					organization_id: "international",
					title: "访学费用",
					released_at: "2026-03-25T00:00:00Z",
					is_external: false,
					external_url: null,
					content_html: "<p>学费约2.1万美元</p>",
					content_text: "【项目费用】\n学费约2.1万美元",
					category: "交流",
					is_published: true,
				},
			],
		};
		const first = await importNoticeSources(client, rows);
		assert.equal(first.inserted, 1);
		assert.equal(first.source_chunk_eligible, 1);
		const repeated = await importNoticeSources(client, rows);
		assert.equal(repeated.inserted, 0);
		assert.equal(repeated.updated, 0);
		assert.equal(repeated.unchanged, 1);
		await client.query("INSERT INTO notices.categories VALUES ('unused')");
		await client.query(`INSERT INTO notices.notices SELECT 900001, notice_type, organization_id,
		 title, released_at, is_external, external_url, content_html, content_text, category, is_published, source_ref, published_source_ref FROM notices.notices WHERE notice_id=355214`);
		rows["notices.notices"][0].content_text = "更新后的费用正文";
		rows["notices.organizations"][0].name = "更新后的组织";
		const updated = await importNoticeSources(client, rows);
		assert.equal(updated.updated, 1);
		assert.deepEqual(updated.local_extra_ids, ["900001"]);
		assert.equal(updated.local_extra_chunk_eligible, 1);
		const snapshot = await exportNoticeSources(client);
		assert.equal(snapshot["notices.notices"].length, 2);
		assert.deepEqual(snapshot["notices.categories"], [{ category: "交流" }]);
		assert.equal(snapshot["notices.organizations"][0].name, "更新后的组织");
		const invalid = structuredClone(rows);
		invalid["notices.organizations"][0].name = "必须回滚";
		invalid["notices.notices"][0].organization_id = "missing";
		await assert.rejects(importNoticeSources(client, invalid), /foreign key/iu);
		assert.deepEqual(await exportNoticeSources(client), snapshot);

		await client.query("SET TIME ZONE 'America/Los_Angeles'");
		const selection = parseNoticeSyncSelection({
			releasedFrom: "2026-09-01",
			releasedTo: "2026-10-03",
		});
		const boundaryRows: NoticeSourceRows = {
			"notices.categories": [{ category: "范围内" }, { category: "范围外" }],
			"notices.notice_types": [
				{ notice_type: 2, name: "范围内类型" },
				{ notice_type: 3, name: "范围外类型" },
			],
			"notices.organizations": [
				{ organization_id: "inside", name: "范围内组织" },
				{ organization_id: "outside", name: "范围外组织" },
			],
			"notices.notices": [
				{ notice_id: 900010, released_at: "2026-08-31T15:59:59.999999Z", inside: false },
				{ notice_id: 900009, released_at: "2026-08-31T16:00:00Z", inside: true },
				{ notice_id: 900008, released_at: "2026-10-02T15:59:59.999999Z", inside: true },
				{ notice_id: 900007, released_at: "2026-10-02T16:00:00Z", inside: false },
			].map(({ inside, ...notice }) => ({
				...rows["notices.notices"][0],
				...notice,
				notice_type: inside ? 2 : 3,
				organization_id: inside ? "inside" : "outside",
				category: inside ? "范围内" : "范围外",
				is_published: !inside,
			})),
		};
		await importNoticeSources(client, boundaryRows);
		const beforeRange = await exportNoticeSources(client);
		assert.equal(beforeRange["notices.notices"].length, 6);
		const ranged = await exportNoticeSources(client, selection);
		assert.deepEqual(
			ranged["notices.notices"].map((row) => row.notice_id),
			[900008, 900009],
		);
		assert.deepEqual(ranged["notices.categories"], [{ category: "范围内" }]);
		assert.deepEqual(ranged["notices.notice_types"], [{ notice_type: 2, name: "范围内类型" }]);
		assert.deepEqual(ranged["notices.organizations"], [
			{ organization_id: "inside", name: "范围内组织" },
		]);
		assert.deepEqual(await exportNoticeSources(client), beforeRange);

		// Simulate importing the selected source snapshot into a local database with other notices.
		await client.query("DELETE FROM notices.notices WHERE notice_id IN (900008, 900009)");
		const importedRange = await importNoticeSources(client, ranged);
		assert.equal(importedRange.inserted, 2);
		assert.deepEqual(importedRange.local_extra_ids, ["355214", "900001", "900007", "900010"]);
		assert.equal(importedRange.local_extra_chunk_eligible, 4);
		assert.deepEqual(await exportNoticeSources(client), beforeRange);
		const repeatedRange = await importNoticeSources(client, ranged);
		assert.equal(repeatedRange.inserted, 0);
		assert.equal(repeatedRange.updated, 0);
		assert.equal(repeatedRange.unchanged, 2);
		ranged["notices.notices"][0].content_text = "范围同步更新的正文";
		const changedRange = await importNoticeSources(client, ranged);
		assert.equal(changedRange.updated, 1);
		assert.deepEqual(await exportNoticeSources(client, selection), ranged);

		const beforeEmpty = await exportNoticeSources(client);
		const empty = await exportNoticeSources(
			client,
			parseNoticeSyncSelection({ releasedFrom: "2026-10-04", releasedTo: "2026-10-05" }),
		);
		for (const values of Object.values(empty)) {
			assert.deepEqual(values, []);
		}
		const importedEmpty = await importNoticeSources(client, empty);
		assert.equal(importedEmpty.inserted, 0);
		assert.equal(importedEmpty.updated, 0);
		assert.equal(importedEmpty.source_notices, 0);
		assert.equal(importedEmpty.local_extra_count, 6);
		assert.deepEqual(await exportNoticeSources(client), beforeEmpty);
	} finally {
		if (created) {
			await client.query("DROP SCHEMA notices CASCADE");
		}
		await client.end();
	}
});
