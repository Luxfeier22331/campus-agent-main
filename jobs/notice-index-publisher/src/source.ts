import type { Pool, PoolClient } from "pg";

import { htmlToStructuredText } from "@campus-agent/text-normalization";

import type { NoticeAssetSection, NoticeSource } from "./types.ts";

// Source assembly reads available OCR text in the same snapshot as the notice.
// Chunking and embedding receive text only; neither knows OCR task states.
// Both image and PDF-attachment OCR text pass the shared HTML-to-text
// normalization so tables reach the chunker as logical `；`-joined rows.
// Each asset is returned separately so the chunker can start it as its own
// hard section instead of continuing the body's last heading.
export const PUBLISHED_NOTICE_SOURCE_QUERY = `SELECT notice_id::text, title, content_text, released_at,
  COALESCE((
    SELECT json_agg(
      json_build_object('kind', asset.asset_kind, 'name', asset.original_name, 'text', pages.text)
      ORDER BY asset.asset_kind = 'attachment', asset.ordinal
    )
    FROM notices.notice_assets asset
    JOIN LATERAL (
      SELECT t.id
      FROM ocr.tasks t
      WHERE t.input->>'kind' = 'source'
        AND t.input->>'noticeId' = n.notice_id::text
        AND t.input_sha256 = asset.content_sha256
        AND CASE asset.asset_kind
          WHEN 'image' THEN t.input #>> '{resource,kind}' = 'image'
            OR t.input->>'key' ~ ('^internal_portal/notices/' || n.notice_id || '/images/[0-9]+$')
          ELSE t.input #>> '{resource,kind}' = 'attachment'
        END
        AND t.status = 'completed'
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT 1
    ) task ON true
    JOIN LATERAL (
      SELECT string_agg(p.markdown, E'\\n\\n' ORDER BY p.page_index) AS text
      FROM ocr.pages p
      WHERE p.task_id = task.id
    ) pages ON pages.text IS NOT NULL
    WHERE asset.notice_id = n.notice_id
      AND (asset.asset_kind = 'image' OR asset.content_type = 'application/pdf')
  ), '[]') AS assets
FROM notices.notices n
WHERE is_published AND NOT is_external AND unavailable_at IS NULL
ORDER BY notice_id`;

interface NoticeAssetText {
	kind: "attachment" | "image";
	name: string | null;
	text: string;
}

interface NoticeSourceRow {
	assets: unknown;
	content_text: string | null;
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
		!Array.isArray(row.assets) ||
		!row.assets.every(isAssetText) ||
		(row.released_at instanceof Date && Number.isNaN(row.released_at.getTime()))
	) {
		throw new Error("published notice source row is invalid");
	}
	// Images are inline body illustrations whose position is lost here, so
	// their text shares one section without the body's heading context;
	// every PDF attachment is its own document under its file name.
	const sections: { heading?: string; text: string }[] = [];
	const imageText = row.assets
		.filter((asset) => asset.kind === "image")
		.map((asset) => cleanOcrText(asset.text))
		.filter(Boolean)
		.join("\n\n");
	if (imageText) sections.push({ text: imageText });
	for (const asset of row.assets) {
		if (asset.kind !== "attachment") continue;
		const text = cleanOcrText(asset.text);
		if (text) sections.push({ heading: attachmentHeading(asset.name), text });
	}
	let contentText = row.content_text?.trim() ? row.content_text : "";
	const assetSections: NoticeAssetSection[] = [];
	for (const section of sections) {
		if (contentText) contentText += "\n\n";
		assetSections.push({
			...(section.heading ? { heading: section.heading } : {}),
			start: contentText.length,
		});
		contentText += section.text;
	}
	return {
		...(assetSections.length > 0 ? { assetSections } : {}),
		contentText: contentText || row.title,
		noticeId: row.notice_id,
		releasedAt: new Date(String(row.released_at)).toISOString(),
		title: row.title,
	};
}

function isAssetText(value: unknown): value is NoticeAssetText {
	const asset = value as NoticeAssetText | null;
	return (
		typeof asset === "object" &&
		asset !== null &&
		(asset.kind === "image" || asset.kind === "attachment") &&
		(asset.name === null || typeof asset.name === "string") &&
		typeof asset.text === "string"
	);
}

function attachmentHeading(name: string | null): string {
	const label = name?.replace(/\s+/gu, " ").trim();
	return label ? `附件《${label}》` : "附件";
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
