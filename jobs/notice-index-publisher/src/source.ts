import type { Pool, PoolClient } from "pg";

import type { NoticeSource } from "./types.ts";

export const PUBLISHED_NOTICE_SOURCE_QUERY = `SELECT notice_id::text, title, content_text, released_at
FROM notices.notices
WHERE is_published
  AND content_text IS NOT NULL
ORDER BY notice_id`;

interface NoticeSourceRow {
	content_text: string;
	notice_id: string;
	released_at: Date | string;
	title: string;
}

export async function loadPublishedNoticeSources(
	pool: Pick<Pool, "connect">,
	signal?: AbortSignal,
): Promise<NoticeSource[]> {
	signal?.throwIfAborted();
	const client = await pool.connect();
	let released = false;
	const abort = () => { if (!released) { released = true; client.release(true); } };
	signal?.addEventListener("abort", abort, { once: true });
	try {
		signal?.throwIfAborted();
		const sources = await loadInSnapshot(client);
		signal?.throwIfAborted();
		return sources;
	} finally {
		signal?.removeEventListener("abort", abort);
		if (!released) client.release();
	}
}

export function sortNoticeSources(sources: readonly NoticeSource[]): NoticeSource[] {
	return [...sources].sort((left, right) => compareNoticeIds(left.noticeId, right.noticeId));
}

async function loadInSnapshot(client: PoolClient): Promise<NoticeSource[]> {
	await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const result = await client.query<NoticeSourceRow>(PUBLISHED_NOTICE_SOURCE_QUERY);
		const sources = result.rows.map((row) => {
			if (
				typeof row.notice_id !== "string" ||
				!row.notice_id ||
				typeof row.title !== "string" ||
				!row.title ||
				typeof row.content_text !== "string" ||
				(row.released_at instanceof Date && Number.isNaN(row.released_at.getTime()))
			) {
				throw new Error("published notice source row is invalid");
			}
			return {
				contentText: row.content_text,
				noticeId: row.notice_id,
				releasedAt: new Date(String(row.released_at)).toISOString(),
				title: row.title,
			};
		});
		await client.query("COMMIT");
		return sources;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	}
}

function compareNoticeIds(left: string, right: string): number {
	const leftNumber = BigInt(left);
	const rightNumber = BigInt(right);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}
