import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { applyDomainRows, readDomainRows } from "./domain-database.ts";
import { createProductSeed } from "./product-data-seed.ts";

// The caller supplies an empty, migrated, disposable database, as with notice-sync.test.ts.
test("domain initialization preserves edits and limits transactional replacement to its owners", {
	skip: !process.env.LOCAL_DATA_TEST_DATABASE_URL,
}, async () => {
	const client = new Client({ connectionString: process.env.LOCAL_DATA_TEST_DATABASE_URL });
	await client.connect();
	try {
		const seed = createProductSeed(new Date("2026-10-03T00:00:00Z"));
		await client.query("insert into notices.categories(category) values ($1)", [
			seed.rows["notices.categories"][0].category,
		]);
		assert.deepEqual(await applyDomainRows(client, ["notices"], seed.rows, false), ["notices"]);
		await client.query("update notices.notices set title = 'local edit' where notice_id=900001");
		assert.deepEqual(
			await applyDomainRows(client, ["notices", "dining"], seed.rows, false, seed.reviews),
			["dining"],
		);
		const before = await readDomainRows(client, ["notices", "dining"]);
		assert.equal(
			before["notices.notices"].find((row) => String(row.notice_id) === "900001")?.title,
			"local edit",
		);
		assert.equal(
			before["notices.notices"].find((row) => String(row.notice_id) === "900003")?.source_ref,
			seed.rows["notices.notices"][2].source_ref,
		);
		await applyDomainRows(client, ["groups"], seed.rows, true);
		assert.deepEqual(await readDomainRows(client, ["notices", "dining"]), before);
		assert.equal(
			(await client.query("select count(*)::int as count from dining.reviews")).rows[0].count,
			seed.reviews.length,
		);
		await applyDomainRows(client, ["transport"], seed.rows, false);
		await assert.rejects(
			applyDomainRows(client, ["notices"], seed.rows, true),
			/explicitly select transport/u,
		);
		assert.deepEqual(await readDomainRows(client, ["notices", "dining"]), before);
		const bad = structuredClone(seed.rows);
		bad["transport.schedule_period_notices"][0].notice_id = 123456;
		await assert.rejects(
			applyDomainRows(client, ["notices", "transport"], bad, true),
			/missing notice/u,
		);
		assert.deepEqual(await readDomainRows(client, ["notices", "dining"]), before);
		await applyDomainRows(client, ["notices", "transport"], seed.rows, true);
		assert.equal(
			(await client.query("select count(*)::int as count from transport.schedule_period_notices"))
				.rows[0].count,
			1,
		);
		await applyDomainRows(client, ["dining"], seed.rows, true, seed.reviews);
		assert.equal(
			(await client.query("select count(*)::int as count from dining.reviews")).rows[0].count,
			seed.reviews.length,
		);
	} finally {
		await client.end();
	}
});
