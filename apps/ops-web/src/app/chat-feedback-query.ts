import { type ChatFeedbackQuery, ChatFeedbackQuerySchema } from "campus-contracts/chat-feedback";
import { z } from "zod";

export interface ChatFeedbackSearch {
	feedbackId?: string | undefined;
	vote?: string | undefined;
	startDate?: string | undefined;
	endDate?: string | undefined;
	requestId?: string | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
}

export function buildChatFeedbackQuery(
	search: ChatFeedbackSearch,
): { query: ChatFeedbackQuery } | { error: string } {
	for (const value of [search.startDate, search.endDate]) {
		if (value && !z.iso.date().safeParse(value).success) {
			return { error: "请输入有效日期。" };
		}
	}
	const result = ChatFeedbackQuerySchema.safeParse({
		vote: search.vote || undefined,
		requestId: search.requestId?.trim() || undefined,
		cursor: search.cursor,
		from: search.startDate
			? new Date(`${search.startDate}T00:00:00+08:00`).toISOString()
			: undefined,
		to: search.endDate
			? new Date(Date.parse(`${search.endDate}T00:00:00+08:00`) + 86_400_000).toISOString()
			: undefined,
		limit: 50,
	});
	return result.success
		? { query: result.data }
		: { error: "筛选条件无效，请检查日期范围、请求 ID 和分页参数。" };
}

export const feedbackTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

export function feedbackVoteLabel(vote: "helpful" | "unhelpful") {
	return vote === "helpful" ? "有帮助" : "没有帮助";
}
