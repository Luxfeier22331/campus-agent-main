import type { OpsRequestSummary, OpsRequestWindow } from "../shared/ops-contract";
import { OPS_STAGE_TIMING_BUDGETS } from "../shared/stage-timing";
import { formatDuration, formatId, formatTimestamp } from "./format";

export function formatNullableDuration(value: number | null | undefined, emptyLabel: string) {
	return value === null || value === undefined ? emptyLabel : formatDuration(value);
}

export function formatRequestDuration(
	request: Pick<OpsRequestSummary, "durationMs" | "projectedAt" | "startedAt" | "status">,
) {
	if (request.durationMs !== null && request.durationMs !== undefined) {
		return formatDuration(request.durationMs);
	}
	if (request.status === "RUNNING" || request.status === "PENDING") {
		const elapsedMs = Date.parse(request.projectedAt) - Date.parse(request.startedAt);
		if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
			return `截至最近更新${request.status === "PENDING" ? "已等待" : "已运行"} ${formatDuration(elapsedMs)}`;
		}
		return request.status === "PENDING" ? "等待中" : "进行中";
	}
	return "未记录耗时";
}

export function formatStatusLabel(status: string) {
	const labels: Record<string, string> = {
		ACCEPTED: "已接受",
		BLOCKED: "阻塞",
		BREACH: "超预算",
		CANCELLED: "已取消",
		COMPLETED: "已完成",
		DEGRADED: "降级",
		EXECUTED: "已执行",
		FAILED: "失败",
		FRESH: "最新",
		HEALTHY: "正常",
		NO_DATA: "无数据",
		NOT_USED: "未使用",
		OK: "正常",
		OUTAGE: "中断",
		PENDING: "待处理",
		READY: "正常",
		RUNNING: "运行中",
		SKIPPED: "已跳过",
		STALE: "已过期",
		UNAVAILABLE: "不可用",
		UNKNOWN: "未知",
		WARN: "预警",
	};
	return labels[status] ?? status;
}

export function formatStageTimingLabel(field: string) {
	const labels: Record<string, string> = {
		"agent.first_delta_ms": "Agent 首次输出",
		"agent.primary_ms": "主要 Agent 执行",
		"agent.runtime_ms": "Agent 运行",
		"execution.admission_ms": "执行接入",
		"finalization.write_ms": "结果写入",
		"memory.recall_ms": "记忆读取",
		"projection.closeout_ms": "状态收尾",
		"rag.grounding_ms": "回答依据检查",
		"rag.lookup_ms": "知识检索",
		"rag.plan_ms": "检索规划",
		"rag.rerank_ms": "检索结果排序",
		"rag.synthesis_ms": "检索回答生成",
		"request.total_ms": "请求总耗时",
		"stream.browser_ttft_ms": "页面首次响应",
		"tool.campus_notice_discover_ms": "校园通知工具",
		"tool.knowledge_query_ms": "知识查询工具",
		"tool.total_ms": "工具总耗时",
		"tool.transport_schedule_lookup_ms": "班车查询工具",
	};
	return labels[field] ?? field;
}

export function formatDataStateLabel(state: string) {
	return formatStatusLabel(state);
}

export function formatRequestCompletedAt(
	request: Pick<OpsRequestSummary, "completedAt" | "status">,
) {
	if (request.completedAt) {
		return formatTimestamp(request.completedAt);
	}
	return request.status === "RUNNING" || request.status === "PENDING" ? "未完成" : "未记录完成时间";
}

export function requestFilterLabels(search: Partial<RequestSearchLike>) {
	return [
		search.status ? `状态 ${formatStatusLabel(search.status)}` : null,
		search.q ? `关键词搜索 ${search.q}` : null,
		search.requestId ? `requestId 精确 ${formatId(search.requestId)}` : null,
		search.traceId ? `traceId 精确 ${formatId(search.traceId)}` : null,
		search.conversationId ? `conversationId 精确 ${formatId(search.conversationId)}` : null,
		search.window ? `时间范围 ${formatRequestWindowLabel(search.window)}` : null,
	].filter((item): item is string => Boolean(item));
}

export function requestSearchDraftFromSearch(search: Partial<RequestSearchLike>) {
	return {
		conversationId: search.conversationId ?? "",
		limit: String(search.limit ?? 50),
		q: search.q ?? "",
		requestId: search.requestId ?? "",
		status: search.status ?? "",
		traceId: search.traceId ?? "",
		window: search.window ?? "1h",
	};
}

export function cleanRequestSearch<T extends Partial<RequestSearchLike>>(search: T): T {
	return {
		...(search.conversationId ? { conversationId: search.conversationId } : {}),
		...(search.cursor ? { cursor: search.cursor } : {}),
		...(search.limit ? { limit: search.limit } : {}),
		...(search.previous ? { previous: search.previous } : {}),
		...(search.q ? { q: search.q } : {}),
		...(search.requestId ? { requestId: search.requestId } : {}),
		...(search.status ? { status: search.status } : {}),
		...(search.traceId ? { traceId: search.traceId } : {}),
		...(search.window && search.window !== "1h" ? { window: search.window } : {}),
	} as T;
}

export function requestListPath(search: Partial<RequestSearchLike>) {
	const clean = cleanRequestSearch({ ...search, previous: undefined });
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(clean)) {
		if (value !== undefined && value !== "") {
			query.set(key, String(value));
		}
	}
	const serialized = query.toString();
	return serialized ? `/requests?${serialized}` : "/requests";
}

export function normalizeRequestListReturnPath(value: string | undefined) {
	if (!value) {
		return "/requests";
	}
	try {
		const parsed = new URL(value, "https://ops-web.local");
		if (parsed.origin !== "https://ops-web.local" || parsed.pathname !== "/requests") {
			return "/requests";
		}
		return `${parsed.pathname}${parsed.search}`;
	} catch {
		return "/requests";
	}
}

export function normalizePreviousRequestListPath(value: string | undefined) {
	return normalizeRequestListReturnPath(value);
}

export function optionalSearchString(value: unknown) {
	if (typeof value !== "string") {
		return;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function optionalBoundedSearchString(value: unknown, maxLength: number) {
	const normalized = optionalSearchString(value);
	if (!normalized || normalized.length > maxLength) {
		return;
	}
	return normalized;
}

export function ignoredRequestSearchParamNames(
	rawSearch: Record<string, unknown>,
	parsedSearch: Partial<RequestSearchLike>,
): string[] {
	const ignored = [
		isIgnoredParam(rawSearch, parsedSearch, "status"),
		isIgnoredParam(rawSearch, parsedSearch, "limit"),
		isIgnoredParam(rawSearch, parsedSearch, "q"),
		isIgnoredParam(rawSearch, parsedSearch, "requestId"),
		isIgnoredParam(rawSearch, parsedSearch, "traceId"),
		isIgnoredParam(rawSearch, parsedSearch, "conversationId"),
		isIgnoredParam(rawSearch, parsedSearch, "cursor"),
		isIgnoredParam(rawSearch, parsedSearch, "window"),
	].filter((value): value is string => Boolean(value));
	return [...new Set(ignored)];
}

function isIgnoredParam(
	rawSearch: Record<string, unknown>,
	parsedSearch: Partial<RequestSearchLike>,
	key: keyof RequestSearchLike,
): string | null {
	const raw = rawSearch[key];
	if (!hasRawSearchValue(raw)) {
		return null;
	}
	return parsedSearch[key] === undefined ? key : null;
}

function hasRawSearchValue(value: unknown) {
	if (typeof value === "string") {
		return value.length > 0;
	}
	return typeof value === "number" && Number.isFinite(value);
}

export function optionalLimit(value: unknown) {
	const parsed =
		typeof value === "string" || typeof value === "number" ? Number(String(value)) : Number.NaN;
	return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : undefined;
}

export function optionalStatus(value: unknown): OpsRequestSummary["status"] | undefined {
	if (
		value === "COMPLETED" ||
		value === "FAILED" ||
		value === "CANCELLED" ||
		value === "RUNNING" ||
		value === "PENDING"
	) {
		return value;
	}
	return;
}

export function optionalRequestWindow(value: unknown): OpsRequestWindow | undefined {
	return value === "1h" || value === "6h" || value === "24h" || value === "7d" ? value : undefined;
}

export function formatRequestWindowLabel(value: OpsRequestWindow) {
	return { "1h": "1 小时", "6h": "6 小时", "24h": "24 小时", "7d": "7 天" }[value];
}

export function orderedStageTimingEntries(
	stageTiming: Record<string, number>,
	stageTimingBudget: Record<string, string>,
) {
	return OPS_STAGE_TIMING_BUDGETS.flatMap((rule) =>
		typeof stageTiming[rule.field] === "number"
			? [
					{
						budget: stageTimingBudget[rule.field] ?? "OK",
						key: rule.field,
						value: stageTiming[rule.field],
					},
				]
			: [],
	);
}

export interface RequestSearchLike {
	conversationId?: string;
	cursor?: string;
	ignored?: string;
	limit?: number;
	previous?: string;
	q?: string;
	requestId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	window?: OpsRequestWindow;
}
