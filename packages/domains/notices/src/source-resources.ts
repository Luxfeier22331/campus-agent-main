import { normalizeNoticeContent } from "./content.ts";

export type NoticeSourceResource =
	| {
			kind: "image";
			noticeId: string;
			ordinal: number;
			sourceKey: string;
	  }
	| {
			kind: "attachment";
			noticeId: string;
			ordinal: number;
			sourceKey: string;
			suffix: string | null;
	  };

export function listNoticeSourceResources(
	noticeId: string,
	source: {
		notice_id: number;
		is_external: boolean;
		notice_content_html: string | null;
		notice_title?: string;
		attachments: readonly { suffix: string | null }[];
	},
	portalHost: string,
): NoticeSourceResource[] {
	if (String(source.notice_id) !== noticeId) {
		throw new Error("Notice source identity mismatch");
	}
	if (source.is_external) {
		return [];
	}
	const resources: NoticeSourceResource[] = normalizeNoticeContent({
		html: source.notice_content_html,
		title: source.notice_title ?? "",
		portalHost,
	}).images.map((image) => ({
		kind: "image",
		noticeId,
		ordinal: image.sourceOrdinal,
		sourceKey: `internal_portal/notices/${noticeId}/images/${image.sourceOrdinal}`,
	}));
	for (const [ordinal, attachment] of source.attachments.entries()) {
		resources.push({
			kind: "attachment",
			noticeId,
			ordinal,
			sourceKey: `internal_portal/notices/${noticeId}/attachments/${ordinal}`,
			suffix: attachment.suffix,
		});
	}
	return resources;
}
