import type { Pool, PoolClient } from "pg";

import type { NoticeSource } from "./types.ts";

export const PUBLISHED_NOTICE_SOURCE_QUERY = `SELECT notice_id::text, title, content_text
FROM notices.notices
WHERE is_published
  AND content_text IS NOT NULL
ORDER BY notice_id`;

interface NoticeSourceRow {
	content_text: string;
	notice_id: string;
	title: string;
}

export async function loadPublishedNoticeSources(
	pool: Pick<Pool, "connect">,
): Promise<NoticeSource[]> {
	const client = await pool.connect();
	try {
		return await loadInSnapshot(client);
	} finally {
		client.release();
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
				typeof row.content_text !== "string"
			) {
				throw new Error("published notice source row is invalid");
			}
			return {
				contentText: row.content_text,
				noticeId: row.notice_id,
				title: row.title,
			};
		});
		await client.query("COMMIT");
		return sources;
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
}

function compareNoticeIds(left: string, right: string): number {
	const leftNumber = BigInt(left);
	const rightNumber = BigInt(right);
	return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}
