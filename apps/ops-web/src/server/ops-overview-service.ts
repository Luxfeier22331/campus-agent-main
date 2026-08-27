import {
	type OpsDataState,
	type OpsHealthStatus,
	type OpsOverviewResponse,
	OpsOverviewResponseSchema,
	type OpsOverviewWindow,
} from "../shared/ops-contract.ts";
import type { OpsStatusOverview, OpsStatusStore } from "./ops-status-types.ts";
import { raceWithSignal } from "./race-with-signal.ts";

const DEFAULT_TIMEOUT_MS = 3_000;
const FRESH_CACHE_MS = 15_000;
const STALE_CACHE_MS = 5 * 60_000;

export interface OpsOverviewService {
	getOverview(
		window: OpsOverviewWindow,
		input?: { signal?: AbortSignal },
	): Promise<OpsOverviewResponse>;
}

interface SourceCache<T> {
	storedAt: number;
	value: T;
}

interface ResolvedSource<T> {
	ageMs: number;
	stale: boolean;
	value: T;
}

export function createOpsOverviewService(input: {
	cacheTtlMs?: number;
	now?: () => Date;
	staleTtlMs?: number;
	store: Pick<OpsStatusStore, "getOverview">;
	timeoutMs?: number;
}): OpsOverviewService {
	const now = input.now ?? (() => new Date());
	const cacheTtlMs = input.cacheTtlMs ?? FRESH_CACHE_MS;
	const staleTtlMs = input.staleTtlMs ?? STALE_CACHE_MS;
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const responseCache = new Map<OpsOverviewWindow, OpsOverviewResponse>();
	const statusCache = new Map<OpsOverviewWindow, SourceCache<OpsStatusOverview>>();
	const statusFlights = new Map<OpsOverviewWindow, Promise<OpsStatusOverview>>();

	return {
		async getOverview(window, queryInput = {}) {
			const requestedAt = now();
			const requestedAtMs = requestedAt.valueOf();
			const cached = responseCache.get(window);
			const responseAgeMs = cached
				? Math.max(0, requestedAtMs - Date.parse(cached.generatedAt))
				: Number.POSITIVE_INFINITY;
			if (cached && responseAgeMs <= cacheTtlMs) {
				return { ...cached, cache: { ageMs: responseAgeMs, status: "FRESH" } };
			}

			const statusPromise = singleFlight(statusFlights, window, () =>
				withTimeout(() => input.store.getOverview(window), timeoutMs),
			);
			const [statusResult] = await raceWithSignal(
				Promise.allSettled([statusPromise]),
				queryInput.signal,
			);
			const status = resolveSource({
				cache: statusCache.get(window),
				fallback: unavailableStatusOverview,
				markStale: markStatusStale,
				nowMs: requestedAtMs,
				result: statusResult,
				staleTtlMs,
			});

			if (statusResult.status === "fulfilled") {
				statusCache.set(window, { storedAt: requestedAtMs, value: statusResult.value });
			}

			const response = OpsOverviewResponseSchema.parse({
				cache: {
					ageMs: status.ageMs,
					status: status.stale ? "STALE" : "FRESH",
				},
				generatedAt: requestedAt.toISOString(),
				health: summarizeHealth(status.value),
				issues: collectIssues(status.value),
				requests: status.value.requests,
				trends: status.value.trends,
				window,
			});
			if (statusResult.status === "fulfilled") {
				responseCache.set(window, response);
			}
			return response;
		},
	};
}

function resolveSource<T>(input: {
	cache: SourceCache<T> | null | undefined;
	fallback: () => T;
	markStale: (value: T) => T;
	nowMs: number;
	result: PromiseSettledResult<T>;
	staleTtlMs: number;
}): ResolvedSource<T> {
	if (input.result.status === "fulfilled") {
		return { ageMs: 0, stale: false, value: input.result.value };
	}
	const ageMs = input.cache ? Math.max(0, input.nowMs - input.cache.storedAt) : 0;
	if (input.cache && ageMs <= input.staleTtlMs) {
		return { ageMs, stale: true, value: input.markStale(input.cache.value) };
	}
	return { ageMs: 0, stale: false, value: input.fallback() };
}

function collectIssues(status: OpsStatusOverview): OpsOverviewResponse["issues"] {
	const issues: OpsOverviewResponse["issues"] = [];
	if (status.requests.dataState === "UNAVAILABLE" || status.requests.dataState === "STALE") {
		issues.push({
			code: `REQUESTS_${status.requests.dataState}`,
			detail: status.requests.reason ?? "请求状态数据库不可用。",
			severity: "WARNING",
			source: "REQUESTS",
			title: "请求状态数据需要检查",
		});
	} else if (status.requests.status === "OUTAGE" || status.requests.status === "DEGRADED") {
		issues.push({
			code: `REQUESTS_${status.requests.status}`,
			detail: status.requests.reason ?? "请求状态异常。",
			severity: status.requests.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "REQUESTS",
			title: status.requests.status === "OUTAGE" ? "请求大面积失败" : "存在失败请求",
		});
	}
	if (status.trends.dataState === "UNAVAILABLE" || status.trends.dataState === "STALE") {
		issues.push({
			code: `REQUEST_TRENDS_${status.trends.dataState}`,
			detail: status.trends.reason ?? "请求趋势数据不可用。",
			severity: "WARNING",
			source: "REQUESTS",
			title: "请求趋势数据需要检查",
		});
	}
	const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
	return issues.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

function summarizeHealth(status: OpsStatusOverview): OpsOverviewResponse["health"] {
	const requestStatus = status.requests.status;
	const healthStatus: OpsHealthStatus =
		requestStatus === "OUTAGE"
			? "OUTAGE"
			: requestStatus === "DEGRADED"
				? "DEGRADED"
				: requestStatus === "UNKNOWN"
					? "UNKNOWN"
					: "HEALTHY";
	return {
		dataState: aggregateDataState([status.requests.dataState, status.trends.dataState]),
		status: healthStatus,
	};
}

function aggregateDataState(states: OpsDataState[]): OpsDataState {
	if (states.length === 0 || states.every((state) => state === "UNAVAILABLE")) {
		return "UNAVAILABLE";
	}
	if (states.some((state) => state === "PARTIAL" || state === "UNAVAILABLE")) {
		return "PARTIAL";
	}
	if (states.some((state) => state === "STALE")) {
		return "STALE";
	}
	if (states.every((state) => state === "NO_DATA")) {
		return "NO_DATA";
	}
	return "FRESH";
}

function unavailableStatusOverview(): OpsStatusOverview {
	return {
		requests: {
			actionRequired: 0,
			cancelled: 0,
			completed: 0,
			dataState: "UNAVAILABLE",
			failed: 0,
			p95DurationMs: null,
			pending: 0,
			reason: "请求状态数据库不可用。",
			running: 0,
			status: "UNKNOWN",
			successRate: null,
			total: 0,
			updatedAt: null,
		},
		trends: {
			data: [],
			dataState: "UNAVAILABLE",
			reason: "请求趋势查询不可用。",
		},
	};
}

function markStatusStale(value: OpsStatusOverview): OpsStatusOverview {
	return {
		...value,
		requests: { ...value.requests, dataState: "STALE", reason: "请求状态刷新失败，显示旧数据。" },
		trends:
			value.trends.dataState === "UNAVAILABLE"
				? value.trends
				: { ...value.trends, dataState: "STALE", reason: "请求趋势刷新失败，显示旧数据。" },
	};
}

function singleFlight<K, T>(
	flights: Map<K, Promise<T>>,
	key: K,
	operation: () => Promise<T>,
): Promise<T> {
	const existing = flights.get(key);
	if (existing) {
		return existing;
	}
	const promise = operation().finally(() => {
		if (flights.get(key) === promise) {
			flights.delete(key);
		}
	});
	flights.set(key, promise);
	return promise;
}

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("ops overview source timed out")),
		timeoutMs,
	);
	let promise: Promise<T>;
	try {
		promise = operation();
	} catch (error) {
		clearTimeout(timeout);
		return Promise.reject(error);
	}
	return raceWithSignal(promise, controller.signal).finally(() => clearTimeout(timeout));
}
