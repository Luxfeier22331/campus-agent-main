import { describe, expect, it } from "vitest";
import { createNoticeDatabasePool, recordNoticeProcessingFailure } from "@campus-agent/notice-database";
import { runNoticeClassificationJob } from "../src/job.ts";
const enabled = Boolean(process.env.NOTICES_DATABASE_URL);
describe.skipIf(!enabled)("classification issue recovery with PostgreSQL", () => {
	it("excludes recorded failures from automatic rounds and clears after explicit success", async () => {
		const pool = createNoticeDatabasePool(process.env, { max: 1 });
		const client = await pool.connect();
		await client.query("BEGIN");
		try {
			const row = (await client.query("SELECT notice_id::text FROM notices.notices ORDER BY notice_id LIMIT 1")).rows[0];
			if (!row) throw new Error("Initialize the worktree product seed before integration tests");
			const id = Number(row.notice_id);
			await client.query("UPDATE notices.notices SET category=NULL, is_published=false WHERE notice_id=$1", [id]);
			await recordNoticeProcessingFailure(client, id, "classification", new Error("invalid response"));
			await runNoticeClassificationJob({ database: client, createModelClassifier: () => async () => "campus_news" });
			expect((await client.query("SELECT category FROM notices.notices WHERE notice_id=$1", [id])).rows[0].category).toBeNull();
			expect((await runNoticeClassificationJob({ database: client, noticeIds: [id], createModelClassifier: () => async () => "campus_news" })).classified).toBe(1);
			expect((await client.query("SELECT * FROM notices.processing_failures WHERE notice_id=$1 AND stage='classification'", [id])).rows).toHaveLength(0);
		} finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
	});
});
