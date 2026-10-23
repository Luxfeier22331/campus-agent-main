import type { Pool, PoolClient } from "pg";

import { htmlToStructuredText } from "@campus-agent/text-normalization";

import type { NoticeSource } from "./types.ts";

// Source assembly reads available OCR text in the same snapshot as the notice.
// Chunking and embedding receive text only; neither knows OCR task states.
// Both image and PDF-attachment OCR text pass the shared HTML-to-text
// normalization so tables reach the chunker as logical `；`-joined rows.
export const PUBLISHED_NOTICE_SOURCE_QUERY = `SELECT notice_id::text, title, content_text, released_at,
  COALESCE((
    SELECT string_agg(p.markdown, E'\\n\\n' ORDER BY asset.ordinal, p.page_index)
    FROM notices.notice_assets asset
    JOIN LATERAL (
      SELECT t.id
      FROM ocr.tasks t
      WHERE t.input->>'kind' = 'source'
        AND t.input->>'noticeId' = n.notice_id::text
        AND t.input_sha256 = asset.content_sha256
        AND (t.input #>> '{resource,kind}' = 'image'
          OR t.input->>'key' ~ ('^internal_portal/notices/' || n.notice_id || '/images/[0-9]+$'))
        AND t.status = 'completed'
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1
    ) image ON true
    JOIN ocr.pages p ON p.task_id = image.id
    WHERE asset.notice_id = n.notice_id AND asset.asset_kind = 'image'
  ), '') AS image_text,
  COALESCE((
    SELECT string_agg(p.markdown, E'\\n\\n' ORDER BY asset.ordinal, p.page_index)
    FROM notices.notice_assets asset
    JOIN LATERAL (
      SELECT t.id
      FROM ocr.tasks t
      WHERE t.input->>'kind' = 'source'
        AND t.input->>'noticeId' = n.notice_id::text
        AND t.input_sha256 = asset.content_sha256
        AND t.input #>> '{resource,kind}' = 'attachment'
        AND t.status = 'completed'
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1
    ) attachment ON true
    JOIN ocr.pages p ON p.task_id = attachment.id
    WHERE asset.notice_id = n.notice_id AND asset.asset_kind = 'attachment'
      AND asset.content_type = 'application/pdf'
  ), '') AS attachment_text
FROM notices.notices n
WHERE is_published AND NOT is_external AND unavailable_at IS NULL
ORDER BY notice_id`;

interface NoticeSourceRow {
	attachment_text: string;
	content_text: string | null;
	image_text: string;
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
	const abort = () => {
		if (!released) {
			released = true;
			client.release(true);
		}
	};
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
		const sources = result.rows.map(noticeSourceFromRow);
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

// OCR page markdown carries provider HTML (tables, image references); the
// shared normalization turns tables into logical rows and drops markup before
// the text reaches the chunker. Markdown heading markers are provider layout
// output, not notice content — stripping them lets heading detection see the
// underlying 《…》/numbered heading lines.
function cleanOcrText(value: string): string {
	return htmlToStructuredText(value)
		.replace(/^#+[ \t]*/gmu, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
		.replace(/<img\b[^>]*>/giu, "")
		.trim();
}

export function noticeSourceFromRow(row: NoticeSourceRow): NoticeSource {
	if (
		typeof row.notice_id !== "string" ||
		!row.notice_id ||
		typeof row.title !== "string" ||
		!row.title ||
		(row.content_text !== null && typeof row.content_text !== "string") ||
		typeof row.image_text !== "string" ||
		typeof row.attachment_text !== "string" ||
		(row.released_at instanceof Date && Number.isNaN(row.released_at.getTime()))
	) {
		throw new Error("published notice source row is invalid");
	}
	const imageText = cleanOcrText(row.image_text);
	const attachmentText = cleanOcrText(row.attachment_text);
	return {
		contentText:
			[row.content_text, imageText, attachmentText].filter((text) => text?.trim()).join("\n\n") ||
			row.title,
		noticeId: row.notice_id,
		releasedAt: new Date(String(row.released_at)).toISOString(),
		title: row.title,
	};
}

export async function* iteratePublishedNoticeSources(
	pool: Pick<Pool, "connect">,
): AsyncGenerator<NoticeSource> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
		await client.query(
			`DECLARE retrieval_sources NO SCROLL CURSOR FOR ${PUBLISHED_NOTICE_SOURCE_QUERY}`,
		);
		for (;;) {
			const page = await client.query<NoticeSourceRow>("FETCH FORWARD 64 FROM retrieval_sources");
			if (!page.rows.length) break;
			for (const row of page.rows) yield noticeSourceFromRow(row);
		}
		await client.query("COMMIT");
	} finally {
		await client.query("ROLLBACK").catch(() => undefined);
		client.release();
	}
}
