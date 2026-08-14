import type {
	NoticeDetailResponse,
	NoticeListRequestQuery,
	NoticeListResponse,
} from "campus-contracts/notices";

export interface NoticeRecord {
	domain: string;
	externalUrl: string | null;
	isExternal: boolean;
	noticeId: string;
	noticeType: { id: number; name: string };
	organization: { id: string; name: string } | null;
	releasedAt: Date | string;
	title: string;
}

export interface NoticeAssetRecord {
	byteSize: string;
	contentSha256: string;
	contentType: string;
	kind: "attachment" | "image";
	name: string | null;
	ordinal: number;
	portalAnnexId: string | null;
}

export interface NoticeDetailRecord extends NoticeRecord {
	assets: NoticeAssetRecord[];
	contentHtml: string | null;
}

export interface NoticeImageAssetRecord {
	byteSize: string;
	contentSha256: string;
	contentType: string;
}

export interface NoticeListRecords {
	items: NoticeRecord[];
	noticeTypes: Array<{ id: number; name: string }>;
	organizations: Array<{ id: string; name: string }>;
	totalItems: number;
}

export interface NoticeStore {
	getDetail(noticeId: string): Promise<NoticeDetailRecord | null>;
	getImageAsset(noticeId: string, ordinal: number): Promise<NoticeImageAssetRecord | null>;
	list(input: NoticeListRequestQuery): Promise<NoticeListRecords>;
}

export interface NoticeObjectStore {
	get(contentSha256: string): Promise<Response | null>;
}

export interface NoticeImagePayload {
	body: ReadableStream<Uint8Array>;
	contentType: string;
}

export interface NoticeService {
	getDetail(noticeId: string): Promise<NoticeDetailResponse>;
	list(input: NoticeListRequestQuery): Promise<NoticeListResponse>;
	readImage(noticeId: string, ordinal: number): Promise<NoticeImagePayload>;
}
