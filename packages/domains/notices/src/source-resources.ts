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

interface NoticeSourceResourceRef {
	kind: "images" | "attachments";
	ordinal: number;
	object_key: string | null;
}

/** 来源快照中门户明确 404、没有资源对象的图片来源序号。 */
export function missingNoticeImageSourceOrdinals(source: {
	resources?: readonly NoticeSourceResourceRef[];
}): Set<number> {
	return new Set(
		(source.resources ?? [])
			.filter((ref) => ref.kind === "images" && ref.object_key === null)
			.map((ref) => ref.ordinal),
	);
}

export function listNoticeSourceResources(
	noticeId: string,
	source: {
		notice_id: number;
		is_external: boolean;
		notice_content_html: string | null;
		notice_title?: string;
		attachments: readonly { suffix: string | null }[];
		resources?: readonly NoticeSourceResourceRef[];
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
		missingImageSourceOrdinals: missingNoticeImageSourceOrdinals(source),
		title: source.notice_title ?? "",
		portalHost,
	}).images.map((image) => ({
		kind: "image",
		noticeId,
		ordinal: image.sourceOrdinal,
		sourceKey:
			source.resources?.find((ref) => ref.kind === "images" && ref.ordinal === image.sourceOrdinal)
				?.object_key ?? `internal_portal/notices/${noticeId}/images/${image.sourceOrdinal}`,
	}));
	for (const [ordinal, attachment] of source.attachments.entries()) {
		const ref = source.resources?.find(
			(ref) => ref.kind === "attachments" && ref.ordinal === ordinal,
		);
		if (source.resources && !ref?.object_key) {
			continue;
		}
		resources.push({
			kind: "attachment",
			noticeId,
			ordinal,
			sourceKey: ref?.object_key ?? `internal_portal/notices/${noticeId}/attachments/${ordinal}`,
			suffix: attachment.suffix,
		});
	}
	return resources;
}
