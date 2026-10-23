import {
	type NoticeDetailResponse,
	NoticeDetailResponseSchema,
	type NoticeListRequestQuery,
	type NoticeListResponse,
	NoticeListResponseSchema,
} from "campus-contracts/notices";
import { requestJson } from "@/platform/api/client";

export async function listNotices(
	query: NoticeListRequestQuery,
	input: { signal?: AbortSignal } = {},
): Promise<NoticeListResponse> {
	const search = new URLSearchParams();
	setOptional(search, "q", query.q);
	setOptional(search, "category", query.category);
	setOptional(search, "organization_id", query.organization_id);
	if (query.notice_type !== undefined) {
		search.set("notice_type", String(query.notice_type));
	}
	if (query.is_external !== undefined) {
		search.set("is_external", String(query.is_external));
	}
	setOptional(search, "from", query.from);
	setOptional(search, "to", query.to);
	search.set("stream", query.stream);
	search.set("page", String(query.page));
	const response = await requestJson<unknown>({
		path: `/api/notices?${search.toString()}`,
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
	return NoticeListResponseSchema.parse(response);
}

export async function getNoticeDetail(
	noticeId: string,
	input: { signal?: AbortSignal } = {},
): Promise<NoticeDetailResponse> {
	const response = await requestJson<unknown>({
		path: `/api/notices/${encodeURIComponent(noticeId)}`,
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
	return NoticeDetailResponseSchema.parse(response);
}

function setOptional(search: URLSearchParams, key: string, value: string | undefined): void {
	if (value !== undefined) {
		search.set(key, value);
	}
}
