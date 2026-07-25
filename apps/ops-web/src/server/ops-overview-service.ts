import {
	type OpsDataState,
	type OpsHealthStatus,
	type OpsOverviewResponse,
	OpsOverviewResponseSchema,
	type OpsOverviewWindow,
} from "../shared/ops-contract.ts";
import type { OpsStatusOverview, OpsStatusStore } from "./ops-status-store.ts";
import { raceWithSignal } from "./race-with-signal.ts";

const DEFAULT_TIMEOUT_MS = 3_000;
const FRESH_CACHE_MS = 15_000;
const STALE_CACHE_MS = 5 * 60_000;

export interface OpsRuntimeSignalsSource {
	getServices(input?: { signal?: AbortSignal }): Promise<OpsOverviewResponse["services"]>;
	getTelemetry(
		window: OpsOverviewWindow,
		input?: { signal?: AbortSignal },
	): Promise<OpsOverviewResponse["telemetry"]>;
}

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
	signals: OpsRuntimeSignalsSource;
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
	const telemetryCache = new Map<
		OpsOverviewWindow,
		SourceCache<OpsOverviewResponse["telemetry"]>
	>();
	let servicesCache: SourceCache<OpsOverviewResponse["services"]> | null = null;
	const statusFlights = new Map<OpsOverviewWindow, Promise<OpsStatusOverview>>();
	const telemetryFlights = new Map<OpsOverviewWindow, Promise<OpsOverviewResponse["telemetry"]>>();
	let servicesFlight: Promise<OpsOverviewResponse["services"]> | null = null;

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
			servicesFlight ??= withTimeout(
				(signal) => input.signals.getServices({ signal }),
				timeoutMs,
			).finally(() => {
				servicesFlight = null;
			});
			const telemetryPromise = singleFlight(telemetryFlights, window, () =>
				withTimeout((signal) => input.signals.getTelemetry(window, { signal }), timeoutMs),
			);
			const results = await raceWithSignal(
				Promise.allSettled([statusPromise, servicesFlight, telemetryPromise]),
				queryInput.signal,
			);
			const [statusResult, servicesResult, telemetryResult] = results;
			const status = resolveSource({
				cache: statusCache.get(window),
				fallback: unavailableStatusOverview,
				markStale: markStatusStale,
				nowMs: requestedAtMs,
				result: statusResult,
				staleTtlMs,
			});
			const services = resolveSource({
				cache: servicesCache,
				fallback: () => [],
				markStale: markServicesStale,
				nowMs: requestedAtMs,
				result: servicesResult,
				staleTtlMs,
			});
			const telemetry = resolveSource({
				cache: telemetryCache.get(window),
				fallback: unavailableTelemetry,
				markStale: markTelemetryStale,
				nowMs: requestedAtMs,
				result: telemetryResult,
				staleTtlMs,
			});

			if (statusResult.status === "fulfilled") {
				statusCache.set(window, { storedAt: requestedAtMs, value: statusResult.value });
			}
			if (servicesResult.status === "fulfilled") {
				servicesCache = { storedAt: requestedAtMs, value: servicesResult.value };
			}
			if (telemetryResult.status === "fulfilled") {
				telemetryCache.set(window, { storedAt: requestedAtMs, value: telemetryResult.value });
			}

			const issues = collectIssues(status.value, services.value);
			const response = OpsOverviewResponseSchema.parse({
				cache: {
					ageMs: Math.max(status.ageMs, services.ageMs, telemetry.ageMs),
					status: status.stale || services.stale || telemetry.stale ? "STALE" : "FRESH",
				},
				externalLinks: status.value.externalLinks,
				generatedAt: requestedAt.toISOString(),
				health: summarizeHealth(status.value, services.value),
				issues,
				requests: status.value.requests,
				services: services.value,
				telemetry: telemetry.value,
				temporal: status.value.temporal,
				trends: status.value.trends,
				window,
			});
			if (
				statusResult.status === "fulfilled" &&
				servicesResult.status === "fulfilled" &&
				telemetryResult.status === "fulfilled"
			) {
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

function collectIssues(
	status: OpsStatusOverview,
	services: OpsOverviewResponse["services"],
): OpsOverviewResponse["issues"] {
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
	const temporalNotConfigured =
		status.temporal.dataState === "NO_DATA" && status.temporal.queues.length === 0;
	if (!temporalNotConfigured && status.temporal.status !== "HEALTHY") {
		issues.push({
			code: `TEMPORAL_${status.temporal.dataState}_${status.temporal.status}`,
			detail: status.temporal.reason ?? "Temporal 队列状态不可用。",
			severity: status.temporal.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "TEMPORAL",
			title: "Temporal 队列需要处理",
		});
	}
	for (const service of services) {
		if (service.status === "HEALTHY") {
			continue;
		}
		issues.push({
			code: `SERVICE_${service.name.replaceAll("-", "_").toUpperCase()}_${service.status}`,
			detail: service.reason ?? `${service.displayName} 状态不可用。`,
			severity: service.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "SERVICE",
			title: `${service.displayName}状态异常`,
		});
	}
	const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
	return [
		...new Map(issues.map((issue) => [`${issue.source}:${issue.code}`, issue])).values(),
	].sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]);
}

function summarizeHealth(
	status: OpsStatusOverview,
	services: OpsOverviewResponse["services"],
): OpsOverviewResponse["health"] {
	const sources = [
		...(status.requests.dataState === "NO_DATA" ? [] : [status.requests]),
		...(status.temporal.dataState === "NO_DATA" && status.temporal.queues.length === 0
			? []
			: [status.temporal]),
		...services,
	];
	const statuses = sources.map((source) => source.status);
	let healthStatus: OpsHealthStatus;
	if (statuses.some((value) => value === "OUTAGE")) {
		healthStatus = "OUTAGE";
	} else if (statuses.some((value) => value === "DEGRADED")) {
		healthStatus = "DEGRADED";
	} else if (statuses.some((value) => value === "UNKNOWN")) {
		healthStatus = "UNKNOWN";
	} else {
		healthStatus = "HEALTHY";
	}
	return {
		dataState: aggregateDataState(sources.map((source) => source.dataState)),
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
		externalLinks: [],
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
		temporal: unavailableTemporal("Temporal 队列查询不可用。"),
		trends: {
			data: [],
			dataState: "UNAVAILABLE",
			reason: "请求趋势查询不可用。",
		},
	};
}

function unavailableTemporal(reason: string): OpsOverviewResponse["temporal"] {
	return {
		backlogCount: 0,
		dataState: "UNAVAILABLE",
		oldestTaskAgeMs: null,
		pollerCount: 0,
		queues: [],
		reason,
		status: "UNKNOWN",
		updatedAt: null,
	};
}

function unavailableTelemetry(): OpsOverviewResponse["telemetry"] {
	return {
		dataState: "UNAVAILABLE",
		reason: "Axiom 查询不可用。",
		signals: [],
		status: "UNKNOWN",
		updatedAt: null,
	};
}

function markStatusStale(value: OpsStatusOverview): OpsStatusOverview {
	return {
		...value,
		requests: { ...value.requests, dataState: "STALE", reason: "请求状态刷新失败，显示旧数据。" },
		temporal: { ...value.temporal, dataState: "STALE", reason: "Temporal 刷新失败，显示旧数据。" },
		trends:
			value.trends.dataState === "UNAVAILABLE"
				? value.trends
				: { ...value.trends, dataState: "STALE", reason: "请求趋势刷新失败，显示旧数据。" },
	};
}

function markServicesStale(
	value: OpsOverviewResponse["services"],
): OpsOverviewResponse["services"] {
	return value.map((service) => ({
		...service,
		dataState: "STALE",
		reason: "服务探针刷新失败，显示旧数据。",
	}));
}

function markTelemetryStale(
	value: OpsOverviewResponse["telemetry"],
): OpsOverviewResponse["telemetry"] {
	return {
		...value,
		dataState: "STALE",
		reason: "观测覆盖刷新失败，显示旧数据。",
		signals: value.signals.map((signal) => ({ ...signal, dataState: "STALE" })),
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

function withTimeout<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("ops overview source timed out")),
		timeoutMs,
	);
	let promise: Promise<T>;
	try {
		promise = operation(controller.signal);
	} catch (error) {
		clearTimeout(timeout);
		return Promise.reject(error);
	}
	return raceWithSignal(promise, controller.signal).finally(() => clearTimeout(timeout));
}
