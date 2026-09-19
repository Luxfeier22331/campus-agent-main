import { z } from "zod";

export const TIME_WINDOWS = [
	"today",
	"24h",
	"this-week",
	"this-month",
	"last-month",
	"30d",
] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];
export type TimeScope = "overview" | "requests" | "conversations" | "accountEvents";
export const DAY_MS = 86_400_000;
export const MAX_TIME_SPAN_MS = 90 * DAY_MS;
const BEIJING_OFFSET_MS = 8 * 3_600_000;
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
	today: "今日",
	"24h": "最近24h",
	"this-week": "本周",
	"this-month": "本月",
	"last-month": "上月",
	"30d": "最近30d",
};
export const TIME_SCOPE: Record<TimeScope, { label: string }> = {
	overview: { label: "请求开始时间" },
	requests: { label: "请求开始时间" },
	conversations: { label: "最近活动时间" },
	accountEvents: { label: "操作发生时间" },
};
export const TimeWindowSchema = z.enum(TIME_WINDOWS);
export const timeQueryShape = {
	window: TimeWindowSchema.optional(),
	from: z.iso.datetime({ offset: true }).optional(),
	to: z.iso.datetime({ offset: true }).optional(),
};
export interface TimeQuery {
	window?: TimeWindow | undefined;
	from?: string | undefined;
	to?: string | undefined;
}
export const TimeFiltersSchema = z
	.object({
		from: z.iso.datetime({ offset: true }).nullable(),
		to: z.iso.datetime({ offset: true }).nullable(),
	})
	.strict();
export type TimeFilters = z.infer<typeof TimeFiltersSchema>;
export interface ResolvedTimeRange {
	from: string;
	to: string;
}

export function validateTimeQuery(_scope: TimeScope) {
	return (value: TimeQuery, ctx: z.RefinementCtx) => {
		const error = (message: string) => ctx.addIssue({ code: "custom", message, path: ["window"] });
		if (value.window && (value.from || value.to)) {
			error("快捷区间和自选日期不能同时使用。");
		}
		if (Boolean(value.from) !== Boolean(value.to)) {
			error("请同时填写开始和结束日期。");
		}
		if (value.from && value.to) {
			const span = Date.parse(value.to) - Date.parse(value.from);
			if (span <= 0) {
				error("结束时间必须晚于开始时间。");
			}
			if (span > MAX_TIME_SPAN_MS) {
				error("时间跨度不能超过90天。");
			}
		}
	};
}
export function timeQuerySchema(scope: TimeScope) {
	return z.object(timeQueryShape).strict().superRefine(validateTimeQuery(scope));
}
export function resolveTimeQuery(
	query: TimeQuery,
	scope: TimeScope,
	now = new Date(),
): ResolvedTimeRange {
	const parsed = timeQuerySchema(scope).parse({
		window: query.window,
		from: query.from,
		to: query.to,
	});
	if (parsed.from && parsed.to) {
		return { from: new Date(parsed.from).toISOString(), to: new Date(parsed.to).toISOString() };
	}
	const window = parsed.window ?? "today";
	const local = new Date(now.valueOf() + BEIJING_OFFSET_MS);
	const midnight =
		Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - BEIJING_OFFSET_MS;
	const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BEIJING_OFFSET_MS;
	const from =
		window === "24h"
			? now.valueOf() - DAY_MS
			: window === "30d"
				? now.valueOf() - 30 * DAY_MS
				: window === "this-week"
					? midnight - ((local.getUTCDay() + 6) % 7) * DAY_MS
					: window === "this-month"
						? monthStart
						: window === "last-month"
							? Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) - BEIJING_OFFSET_MS
							: midnight;
	return {
		from: new Date(from).toISOString(),
		to: new Date(window === "last-month" ? monthStart : now.valueOf()).toISOString(),
	};
}

export function beijingDate(value: string): string {
	return new Date(Date.parse(value) + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/** Date inputs include both calendar days; query endpoints are always [from, to). */
export function dateRangeQuery(startDate: string, endDate: string): ResolvedTimeRange {
	const date = z.iso.date();
	const from = new Date(`${date.parse(startDate)}T00:00:00+08:00`).toISOString();
	const to = new Date(Date.parse(`${date.parse(endDate)}T00:00:00+08:00`) + DAY_MS).toISOString();
	return resolveTimeQuery({ from, to }, "overview");
}

export function timeQueryWindow(query: TimeQuery): TimeWindow | null {
	return query.from || query.to ? null : (query.window ?? "today");
}

/** Rolling presets share their short-lived cache; calendar presets cannot cross their period. */
export function timeQueryCacheKey(query: TimeQuery, range: ResolvedTimeRange): string {
	const window = timeQueryWindow(query);
	if (window === "24h" || window === "30d") {
		return window;
	}
	return window ? `${window}:${range.from}` : `${range.from}/${range.to}`;
}
