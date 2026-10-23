import type { OcrInput, OcrObjects } from "@campus-agent/document-ocr";
import { listNoticeSourceResources } from "@campus-agent/notices";
import type { Pool } from "pg";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };

export async function* selectNoticeInputs(
	pool: Pool,
	objects: OcrObjects,
	noticeId?: string,
	options: { pdfOnly?: boolean } = {},
) {
	if (noticeId !== undefined && !/^[1-9]\d*$/.test(noticeId)) {
		throw new Error("noticeId must be a positive integer");
	}
	const { rows } = await pool.query(
		`select notice_id::text as id, source_ref from notices.notices where not is_external and
  ($1::bigint is null or notice_id=$1)
  order by released_at desc, notice_id desc`,
		[noticeId ?? null],
	);
	for (const row of rows) {
		yield* sourceInputs(row.id, await readSource(objects, row), options);
	}
}

// Scheduled discovery reads only notices that the index can consume and that
// still have a published image/PDF asset without any OCR task; an existing
// task in any state (including failed) covers the asset, so nothing is
// re-billed automatically. Coverage mirrors the index match: content-addressed
// task key, or a legacy task that recorded the same input digest.
const UNCOVERED_ASSETS_QUERY = `select n.notice_id::text as id, n.published_source_ref as source_ref,
  array_agg('internal_portal/resources/sha256/' || a.content_sha256) as keys
from notices.notices n
join notices.notice_assets a on a.notice_id = n.notice_id
where n.is_published and not n.is_external and n.unavailable_at is null
  and ($1::timestamptz is null or n.released_at >= $1)
  and (($2::boolean is not true and a.asset_kind = 'image') or a.content_type = 'application/pdf')
  and not exists (
    select from ocr.tasks t
    where t.dedup_key = 'source:' || n.notice_id || ':internal_portal/resources/sha256/' || a.content_sha256
  )
  and not exists (
    select from ocr.tasks t
    where t.input->>'kind' = 'source' and t.input->>'noticeId' = n.notice_id::text
      and t.input_sha256 = a.content_sha256
  )
group by n.notice_id
order by max(n.released_at) desc, n.notice_id desc`;

export async function* selectUncoveredNoticeInputs(
	pool: Pool,
	objects: OcrObjects,
	options: { pdfOnly?: boolean; since?: Date } = {},
) {
	const { rows } = await pool.query(UNCOVERED_ASSETS_QUERY, [
		options.since ?? null,
		options.pdfOnly ?? false,
	]);
	for (const row of rows) {
		const keys = new Set<string>(row.keys);
		for (const input of sourceInputs(row.id, await readSource(objects, row), options)) {
			if (keys.has(input.key)) {
				yield input;
			}
		}
	}
}

async function readSource(objects: OcrObjects, row: { id: string; source_ref: string | null }) {
	return JSON.parse(
		new TextDecoder().decode(
			await objects.getSource(row.source_ref ?? `internal_portal/notices/${row.id}.json`),
		),
	);
}

function* sourceInputs(
	noticeId: string,
	source: Parameters<typeof listNoticeSourceResources>[1],
	options: { pdfOnly?: boolean },
) {
	const resources = listNoticeSourceResources(
		noticeId,
		source,
		new URL(portal.portal_base_url).hostname,
	).filter((resource) =>
		options.pdfOnly
			? resource.kind === "attachment" &&
				resource.suffix?.replace(/^\./, "").toLowerCase() === "pdf"
			: resource.kind === "image" || resource.suffix?.replace(/^\./, "").toLowerCase() === "pdf",
	);
	let imageDisplayOrdinal = 0;
	let attachmentDisplayOrdinal = 0;
	for (const resource of resources) {
		const displayOrdinal =
			resource.kind === "image" ? imageDisplayOrdinal++ : attachmentDisplayOrdinal++;
		yield {
			kind: "source",
			noticeId: resource.noticeId,
			key: resource.sourceKey,
			contentType: resource.kind === "attachment" ? "application/pdf" : "image/*",
			resource: { kind: resource.kind, ordinal: resource.ordinal, displayOrdinal },
		} satisfies OcrInput;
	}
}
