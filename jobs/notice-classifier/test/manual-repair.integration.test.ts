import { randomInt } from "node:crypto";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createNoticeDatabasePool, recordAutomaticClassificationFailure } from "@campus-agent/notice-database";
import { createPgNoticeStore } from "../../../apps/ops-web/src/server/notice-store.ts";

describe.skipIf(!process.env.NOTICE_TEST_ADMIN_DATABASE_URL)("manual repair and automatic failure ordering", () => {
	it.each(["failure-first", "repair-first"] as const)("%s does not leave a stale issue", async (order) => {
		const pool = createNoticeDatabasePool({
			...process.env, NOTICES_DATABASE_URL: process.env.NOTICE_TEST_ADMIN_DATABASE_URL,
		}, { max: 4 });
		const id = 8_000_000_000 + randomInt(1_000_000);
		const first = await pool.connect();
		const second = await pool.connect();
		let pending: Promise<unknown> | undefined;
		try {
			await pool.query(`INSERT INTO notices.notices(notice_id, notice_type, title, released_at, is_external)
				SELECT $1, notice_type, 'classification race fixture', now(), false FROM notices.notice_types LIMIT 1`, [id]);
			const secondPid = (await second.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
			const store = createPgNoticeStore({
				query: pool.query.bind(pool),
				connect: async () => ({
					query: second.query.bind(second), release() {},
				}),
			} as unknown as Pick<Pool, "query" | "connect">);
			await first.query("BEGIN");
			if (order === "failure-first") {
				await recordAutomaticClassificationFailure(first, id, new Error("invalid output"));
				pending = store.updateCategory(id, "campus_news");
			} else {
				await first.query("UPDATE notices.notices SET category='campus_news', label_category='news', label_intent='result' WHERE notice_id=$1", [id]);
				await first.query("DELETE FROM notices.processing_failures WHERE notice_id=$1", [id]);
				pending = recordAutomaticClassificationFailure(second, id, new Error("late invalid output"));
			}
			// Observe a real blocked backend before committing; no timing-based sleep.
			await expect.poll(async () =>
				(await pool.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [secondPid])).rows[0].blocked,
			).toBe(true);
			await first.query("COMMIT");
			await pending;
			expect((await pool.query("SELECT category FROM notices.notices WHERE notice_id=$1", [id])).rows[0].category).toBe("campus_news");
			expect((await pool.query("SELECT * FROM notices.processing_failures WHERE notice_id=$1", [id])).rows).toHaveLength(0);
		} finally {
			await first.query("ROLLBACK");
			await pending?.catch(() => undefined);
			try { await pool.query("DELETE FROM notices.notices WHERE notice_id=$1", [id]); }
			finally { first.release(); second.release(); await pool.end(); }
		}
	});
});
