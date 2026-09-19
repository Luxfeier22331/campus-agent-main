import { NoticeCategorySchema, NoticeStateSchema } from "../../shared/ops-contract";

export function parseNoticeFilters(search: Record<string, unknown>) {
	const page = Number(search.page);
	return {
		category: NoticeCategorySchema.safeParse(search.category).data ?? ("" as const),
		state: NoticeStateSchema.safeParse(search.state).data ?? ("" as const),
		q: typeof search.q === "string" ? search.q.trim() : "",
		page: Number.isSafeInteger(page) && page > 0 ? page : 1,
	};
}
