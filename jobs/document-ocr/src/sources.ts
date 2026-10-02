import type { OcrInput, OcrObjects } from "@campus-agent/document-ocr";
import { listNoticeSourceResources } from "@campus-agent/notices";
import type { Pool } from "pg";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };

export async function* selectNoticeInputs(pool: Pool, objects: OcrObjects, noticeId?: string) {
	if (noticeId !== undefined && !/^[1-9]\d*$/.test(noticeId)) {
		throw new Error("noticeId must be a positive integer");
	}
	const { rows } = await pool.query(
		`select notice_id::text as id from notices.notices where not is_external and
  ($1::bigint is null or notice_id=$1)
  order by released_at desc, notice_id desc`,
		[noticeId ?? null],
	);
	for (const row of rows) {
		const source = JSON.parse(
			new TextDecoder().decode(await objects.getSource(`internal_portal/notices/${row.id}.json`)),
		);
		const resources = listNoticeSourceResources(
			row.id,
			source,
			new URL(portal.portal_base_url).hostname,
		).filter((resource) => resource.kind === "image");
		for (const [displayOrdinal, resource] of resources.entries()) {
			yield {
				kind: "source",
				noticeId: resource.noticeId,
				key: resource.sourceKey,
				contentType: "image/*",
				resource: { kind: "image", ordinal: resource.ordinal, displayOrdinal },
			} satisfies OcrInput;
		}
	}
}
