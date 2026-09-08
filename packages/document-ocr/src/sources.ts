import { normalizeNoticeContent } from "@campus-agent/notices";
import type { OcrInput } from "./types.ts";

export function noticeInputs(
	noticeId: string,
	source: {
		notice_id: number;
		is_external: boolean;
		notice_content_html: string;
		notice_title?: string;
		attachments: { suffix: string }[];
	},
	portalHost: string,
): OcrInput[] {
	if (String(source.notice_id) !== noticeId) {
		throw new Error("Notice source identity mismatch");
	}
	if (source.is_external) {
		return [];
	}
	const result: OcrInput[] = normalizeNoticeContent({
		html: source.notice_content_html,
		title: source.notice_title ?? "",
		portalHost,
	}).images.map((image) => ({
		kind: "source",
		noticeId,
		key: `internal_portal/notices/${noticeId}/images/${image.sourceOrdinal}`,
		contentType: "image/*",
	}));
	for (const [index, attachment] of source.attachments.entries()) {
		if (attachment.suffix.toLowerCase().replace(/^\./, "") !== "pdf") {
			continue;
		}
		result.push({
			kind: "source",
			noticeId,
			key: `internal_portal/notices/${noticeId}/attachments/${index}`,
			contentType: "application/pdf",
		});
	}
	return result;
}
