import { type ChatFeedbackQuery, ChatFeedbackQuerySchema } from "campus-contracts/chat-feedback";
import { resolveTimeQuery, type TimeQuery } from "campus-contracts/ops-time";
import { z } from "zod";

export interface ChatFeedbackSearch extends TimeQuery {
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
	let time: TimeQuery = {};
	if (search.window || search.from || search.to) {
		try {
			time = resolveTimeQuery(search, "overview");
		} catch {
			return { error: "时间范围无效，请重新选择有效区间（最多90天）。" };
		}
	}
	const result = ChatFeedbackQuerySchema.safeParse({
		vote: search.vote || undefined,
		requestId: search.requestId?.trim() || undefined,
		cursor: search.cursor,
		from:
			time.from ??
			(search.startDate ? new Date(`${search.startDate}T00:00:00+08:00`).toISOString() : undefined),
		to:
			time.to ??
			(search.endDate
				? new Date(Date.parse(`${search.endDate}T00:00:00+08:00`) + 86_400_000).toISOString()
				: undefined),
		limit: 50,
	});
	return result.success
		? { query: result.data }
		: { error: "筛选条件无效，请检查日期范围、请求 ID 和分页参数。" };
}

export function feedbackVoteLabel(vote: "helpful" | "unhelpful") {
	return vote === "helpful" ? "有帮助" : "没有帮助";
}

export const feedbackReasonLabels = {
	wrong_intent: "理解错了问题",
	not_enough_detail: "信息不够详细",
	outdated_or_missing_source: "来源过时或缺失",
	incorrect_answer: "回答不正确",
	unclear_or_hard_to_use: "表达不清或难以使用",
	other: "其他原因",
};
