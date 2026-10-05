import {
	NoticeCategorySchema,
	NoticeProcessingStageSchema,
	NoticeStateSchema,
} from "../../shared/ops-contract";

export function parseNoticeFilters(search: Record<string, unknown>) {
	const page = Number(search.page);
	return {
		from: typeof search.from === "string" && search.from === "/ocr" ? search.from : undefined,
		issueStage: NoticeProcessingStageSchema.safeParse(search.issueStage).data ?? ("" as const),
		category: NoticeCategorySchema.safeParse(search.category).data ?? ("" as const),
		state: NoticeStateSchema.safeParse(search.state).data ?? ("" as const),
		q: typeof search.q === "string" ? search.q.trim() : "",
		page: Number.isSafeInteger(page) && page > 0 ? page : 1,
	};
}
