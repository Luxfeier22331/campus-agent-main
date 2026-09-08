import { noticeInputs, type OcrObjects } from "@campus-agent/document-ocr";
import type { Pool } from "pg";
import portal from "../../../configs/sources/internal-portal.json" with { type: "json" };

export { noticeInputs } from "@campus-agent/document-ocr";
export async function* selectNoticeInputs(pool: Pool, objects: OcrObjects, noticeId?: string) {
	if (noticeId !== undefined && !/^[1-9]\d*$/.test(noticeId)) {
		throw new Error("noticeId must be a positive integer");
	}
	const { rows } = await pool.query(
		`select notice_id::text as id from notices.notices where not is_external and
  ($1::bigint is not null and notice_id=$1 or $1::bigint is null and title ~ '班车|接驳|通勤|社会实践专车')
  order by released_at desc, notice_id desc`,
		[noticeId ?? null],
	);
	for (const row of rows) {
		const source = JSON.parse(
			new TextDecoder().decode(await objects.getSource(`internal_portal/notices/${row.id}.json`)),
		);
		yield* noticeInputs(row.id, source, new URL(portal.portal_base_url).hostname);
	}
}
