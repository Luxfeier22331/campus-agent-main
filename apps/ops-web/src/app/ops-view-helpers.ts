import type {
	OpsRequestListView,
	OpsRequestSummary,
	OpsRequestWindow,
} from "../shared/ops-contract";
import { formatDuration, formatHumanDuration, formatId, formatTimestamp } from "./format";

export function formatNullableDuration(value: number | null | undefined, emptyLabel: string) {
	return value === null || value === undefined ? emptyLabel : formatDuration(value);
}

export function formatRequestDuration(
	request: Pick<OpsRequestSummary, "durationMs" | "startedAt" | "status">,
	generatedAt: string,
) {
	if (request.durationMs !== null && request.durationMs !== undefined) {
		return formatHumanDuration(request.durationMs);
	}
	if (request.status === "RUNNING" || request.status === "PENDING") {
		const elapsedMs = Date.parse(generatedAt) - Date.parse(request.startedAt);
		if (Number.isFinite(elapsedMs) && elapsedMs >= 0) {
			return request.status === "RUNNING"
				? `已运行 ${formatHumanDuration(elapsedMs)}`
				: `已等待 ${formatHumanDuration(elapsedMs)}`;
		}
		return "持续时间不可用";
	}
	if (request.status === "ACTION_REQUIRED") {
		return "已结束，等待用户";
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
		PARTIAL: "部分可用",
		PENDING: "待处理",
		ACTION_REQUIRED: "等待用户",
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
		search.runId ? `runId 精确 ${formatId(search.runId)}` : null,
		search.traceId ? `traceId 精确 ${formatId(search.traceId)}` : null,
		search.workflowId ? `workflowId 精确 ${formatId(search.workflowId)}` : null,
		search.conversationId ? `conversationId 精确 ${formatId(search.conversationId)}` : null,
		search.window ? `时间范围 ${formatRequestWindowLabel(search.window)}` : null,
	].filter((item): item is string => Boolean(item));
}

export function requestSearchDraftFromSearch(search: Partial<RequestSearchLike>) {
	return {
		conversationId: search.conversationId ?? "",
		q: search.q ?? "",
		requestId: search.requestId ?? "",
		runId: search.runId ?? "",
		status: search.status ?? "",
		traceId: search.traceId ?? "",
		view: search.view ?? "recent",
		window: search.window ?? "1h",
		workflowId: search.workflowId ?? "",
	};
}

export function cleanRequestSearch<T extends Partial<RequestSearchLike>>(search: T): T {
	return {
		...(search.conversationId ? { conversationId: search.conversationId } : {}),
		...(search.cursor ? { cursor: search.cursor } : {}),
		...(search.q ? { q: search.q } : {}),
		...(search.requestId ? { requestId: search.requestId } : {}),
		...(search.runId ? { runId: search.runId } : {}),
		...(search.status ? { status: search.status } : {}),
		...(search.traceId ? { traceId: search.traceId } : {}),
		...(search.view && search.view !== "recent" ? { view: search.view } : {}),
		...(search.window && search.window !== "1h" ? { window: search.window } : {}),
		...(search.workflowId ? { workflowId: search.workflowId } : {}),
	} as T;
}

export function requestListPath(search: Partial<RequestSearchLike>) {
	const clean = cleanRequestSearch(search);
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
		hasRawSearchValue(rawSearch.limit) ? "limit" : null,
		hasRawSearchValue(rawSearch.previous) ? "previous" : null,
		isIgnoredParam(rawSearch, parsedSearch, "status"),
		isIgnoredParam(rawSearch, parsedSearch, "q"),
		isIgnoredParam(rawSearch, parsedSearch, "requestId"),
		isIgnoredParam(rawSearch, parsedSearch, "runId"),
		isIgnoredParam(rawSearch, parsedSearch, "traceId"),
		isIgnoredParam(rawSearch, parsedSearch, "workflowId"),
		isIgnoredParam(rawSearch, parsedSearch, "conversationId"),
		isIgnoredParam(rawSearch, parsedSearch, "cursor"),
		isIgnoredParam(rawSearch, parsedSearch, "view"),
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

export function optionalStatus(value: unknown): OpsRequestSummary["status"] | undefined {
	if (
		value === "COMPLETED" ||
		value === "FAILED" ||
		value === "CANCELLED" ||
		value === "RUNNING" ||
		value === "PENDING" ||
		value === "ACTION_REQUIRED"
	) {
		return value;
	}
	return;
}

export function optionalRequestWindow(value: unknown): OpsRequestWindow | undefined {
	return value === "15m" || value === "1h" || value === "6h" || value === "24h" || value === "7d"
		? value
		: undefined;
}

export function optionalRequestListView(value: unknown): OpsRequestListView | undefined {
	return value === "recent" || value === "attention" ? value : undefined;
}

export function formatRequestWindowLabel(value: OpsRequestWindow) {
	return { "15m": "15 分钟", "1h": "1 小时", "6h": "6 小时", "24h": "24 小时", "7d": "7 天" }[
		value
	];
}

export interface RequestSearchLike {
	conversationId?: string;
	cursor?: string;
	ignored?: string;
	q?: string;
	requestId?: string;
	runId?: string;
	status?: OpsRequestSummary["status"];
	traceId?: string;
	view?: OpsRequestListView;
	window?: OpsRequestWindow;
	workflowId?: string;
}
