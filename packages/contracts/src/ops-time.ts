import { z } from "zod";

export const TIME_WINDOWS = ["15m", "1h", "6h", "24h", "7d", "30d", "90d"] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];
export type TimeScope = "overview" | "requests" | "conversations" | "accountEvents";
export const TIME_WINDOW_MS: Record<TimeWindow, number> = {
	"15m": 900_000,
	"1h": 3_600_000,
	"6h": 21_600_000,
	"24h": 86_400_000,
	"7d": 604_800_000,
	"30d": 2_592_000_000,
	"90d": 7_776_000_000,
};
export const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
	"15m": "15 分钟",
	"1h": "1 小时",
	"6h": "6 小时",
	"24h": "24 小时",
	"7d": "7 天",
	"30d": "30 天",
	"90d": "90 天",
};
export const TIME_SCOPE: Record<
	TimeScope,
	{
		windows: readonly TimeWindow[];
		defaultWindow: TimeWindow | null;
		maxSpan: number | null;
		label: string;
	}
> = {
	overview: {
		windows: ["15m", "1h", "6h", "24h"],
		defaultWindow: "1h",
		maxSpan: TIME_WINDOW_MS["24h"],
		label: "请求开始时间",
	},
	requests: {
		windows: ["15m", "1h", "6h", "24h", "7d"],
		defaultWindow: "1h",
		maxSpan: TIME_WINDOW_MS["7d"],
		label: "请求开始时间",
	},
	conversations: {
		windows: ["24h", "7d", "30d", "90d"],
		defaultWindow: null,
		maxSpan: null,
		label: "最近活动时间",
	},
	accountEvents: {
		windows: ["24h", "7d", "30d", "90d"],
		defaultWindow: "7d",
		maxSpan: TIME_WINDOW_MS["90d"],
		label: "操作发生时间",
	},
};
export const timeQueryShape = {
	window: z.enum(TIME_WINDOWS).optional(),
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
export function validateTimeQuery(scope: TimeScope) {
	return (value: TimeQuery, ctx: z.RefinementCtx) => {
		const policy = TIME_SCOPE[scope];
		const error = (message: string) => ctx.addIssue({ code: "custom", message, path: ["window"] });
		if (value.window && !policy.windows.includes(value.window)) {
			error("该页面不支持此时间窗口。");
		}
		if (value.window && (value.from || value.to)) {
			error("快捷窗口和自定义时间不能同时使用。");
		}
		if (scope !== "conversations" && Boolean(value.from) !== Boolean(value.to)) {
			error("请同时填写开始和结束时间。");
		}
		if (value.from && value.to) {
			const span = Date.parse(value.to) - Date.parse(value.from);
			if (span <= 0) {
				error("结束时间必须晚于开始时间。");
			}
			if (policy.maxSpan !== null && span > policy.maxSpan) {
				error("时间跨度超出当前页面支持的范围。");
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
): TimeFilters {
	const parsed = timeQuerySchema(scope).parse(query);
	if (parsed.from || parsed.to) {
		return { from: parsed.from ?? null, to: parsed.to ?? null };
	}
	const window = parsed.window ?? TIME_SCOPE[scope].defaultWindow;
	return window
		? {
				from: new Date(now.valueOf() - TIME_WINDOW_MS[window]).toISOString(),
				to: now.toISOString(),
			}
		: { from: null, to: null };
}
