import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { NoticeListRequestQuery } from "campus-contracts/notices";
import { getNoticeDetail, listNotices } from "./api";

export const noticeQueryKeys = {
	detail: (noticeId: string) => ["notices", "detail", noticeId] as const,
	list: (query: NoticeListRequestQuery) =>
		[
			"notices",
			"list",
			{
				domain: query.domain ?? null,
				from: query.from ?? null,
				isExternal: query.is_external ?? null,
				noticeType: query.notice_type ?? null,
				organizationId: query.organization_id ?? null,
				page: query.page,
				q: query.q ?? null,
				to: query.to ?? null,
			},
		] as const,
};

export function noticeListQueryOptions(query: NoticeListRequestQuery) {
	return queryOptions({
		placeholderData: keepPreviousData,
		queryFn: ({ signal }) => listNotices(query, { signal }),
		queryKey: noticeQueryKeys.list(query),
		staleTime: 30_000,
	});
}

export function noticeDetailQueryOptions(noticeId: string) {
	return queryOptions({
		queryFn: ({ signal }) => getNoticeDetail(noticeId, { signal }),
		queryKey: noticeQueryKeys.detail(noticeId),
		staleTime: 30_000,
	});
}
