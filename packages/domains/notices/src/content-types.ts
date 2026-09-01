import type { NOTICE_CONTENT_ALIGNMENTS } from "campus-contracts/notices";

export type NoticeContentAlignment = (typeof NOTICE_CONTENT_ALIGNMENTS)[number];

export interface NoticeSourcePresentation {
	alert: boolean;
	align: NoticeContentAlignment | null;
	bold: boolean;
	highlight: boolean;
	indent: boolean;
	underline: boolean;
}

export interface NoticeImageReference {
	normalizedUrl: string;
	ordinal: number;
	sourceOrdinal: number;
	sourceUrl: string;
}

export type NoticeAssetKind = "attachment" | "image";

export interface NormalizedNoticeContent {
	contentHtml: string | null;
	contentText: string | null;
	images: NoticeImageReference[];
}
