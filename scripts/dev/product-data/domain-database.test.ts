import assert from "node:assert/strict";
import test from "node:test";
import { applyDomainRows, domainHasData } from "./domain-database.ts";
import { createProductSeed } from "./product-data-seed.ts";

test("preserves an initialized notice domain while applying only empty dining tables", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		if (sql === "select 1 from notices.notices limit 1") {
			return { rows: [{}] };
		}
		if (sql === "select 1 from dining.map_draft limit 1") {
			return { rows: [] };
		}
		if (sql === "select 1 from dining.map_releases limit 1") {
			return { rows: [] };
		}
		if (sql === "select 1 from dining.map_publication limit 1") {
			return { rows: [] };
		}
		if (sql === "select 1 from dining.menu_items limit 1") {
			return { rows: [] };
		}
		return { rows: [] };
	};
	const rows = createProductSeed(new Date("2026-09-18T00:00:00Z")).rows;
	const applied = await applyDomainRows({ query } as never, ["notices", "dining"], rows, false);
	assert.deepEqual(applied, ["dining"]);
	assert(statements.some((sql) => sql.includes("insert into dining.map_releases")));
	assert(!statements.some((sql) => sql.includes("insert into notices.notices")));
	assert(
		statements
			.filter((sql) => sql.startsWith("insert into "))
			.every((sql) => sql.startsWith("insert into dining.")),
	);
});

test("replacement locks and deletes only the selected domain tables", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		if (sql === "select 1 from notices.notices limit 1") {
			return { rows: [{}] };
		}
		return { rows: [] };
	};
	const rows = createProductSeed(new Date("2026-09-18T00:00:00Z")).rows;
	await applyDomainRows({ query } as never, ["groups"], rows, true);
	const lock = statements.find((sql) => sql.startsWith("LOCK TABLE"));
	assert.match(lock ?? "", /campus_groups\.sections, campus_groups\.groups/u);
	assert(!/notices\.|transport\.|dining\./u.test(lock ?? ""));
	assert(statements.some((sql) => sql === "delete from campus_groups.groups"));
	assert(statements.some((sql) => sql === "delete from campus_groups.sections"));
	assert(!statements.some((sql) => sql.startsWith("delete from dining.")));
});

test("notice replacement refuses undeclared transport references before deleting rows", async () => {
	const statements: string[] = [];
	const query = async (sql: string) => {
		statements.push(sql);
		if (sql === "select 1 from transport.schedule_period_notices limit 1") {
			return { rows: [{}] };
		}
		return { rows: [] };
	};
	await assert.rejects(
		applyDomainRows({ query } as never, ["notices"], createProductSeed(new Date()).rows, true),
		/explicitly select transport/u,
	);
	assert(!statements.some((sql) => sql.startsWith("delete from notices.")));
	assert.equal(statements.at(-1), "ROLLBACK");
});

test("notice lookup dictionaries do not make the notice domain look initialized", async () => {
	const query = async (sql: string) => {
		assert.equal(sql, "select 1 from notices.notices limit 1");
		return { rows: [] };
	};
	assert.equal(await domainHasData({ query } as never, "notices"), false);
});
