import {
	type OpsDataState,
	type OpsHealthStatus,
	type OpsOverviewResponse,
	OpsOverviewResponseSchema,
	type OpsOverviewWindow,
} from "../shared/ops-contract.ts";
import type { OpsStatusOverview, OpsStatusStore } from "./ops-status-store.ts";

const DEFAULT_TIMEOUT_MS = 3_000;
const FRESH_CACHE_MS = 15_000;
const STALE_CACHE_MS = 5 * 60_000;
const REQUIRED_SERVICES = [
	["campus-web", "学生端"],
	["app-api", "浏览器接口"],
	["execution-control", "执行控制"],
	["agent-runtime", "Agent 运行服务"],
	["ops-web", "运维工作台"],
] as const;

export type OpsRuntimeSignalsSnapshot = Pick<OpsOverviewResponse, "services" | "telemetry">;

export interface OpsRuntimeSignalsSource {
	getSnapshot(window: OpsOverviewWindow): Promise<OpsRuntimeSignalsSnapshot>;
}

export interface OpsOverviewService {
	getOverview(window: OpsOverviewWindow): Promise<OpsOverviewResponse>;
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
	const completeCache = new Map<OpsOverviewWindow, OpsOverviewResponse>();

	return {
		async getOverview(window) {
			const requestedAt = now();
			const cached = responseCache.get(window);
			const cacheAgeMs = cached
				? Math.max(0, requestedAt.valueOf() - Date.parse(cached.generatedAt))
				: Number.POSITIVE_INFINITY;
			if (cached && cacheAgeMs <= cacheTtlMs) {
				return { ...cached, cache: { ageMs: cacheAgeMs, status: "FRESH" } };
			}

			const [statusResult, signalsResult] = await Promise.allSettled([
				withTimeout(input.store.getOverview(window), timeoutMs),
				withTimeout(input.signals.getSnapshot(window), timeoutMs),
			]);
			const complete = completeCache.get(window);
			const completeAgeMs = complete
				? Math.max(0, requestedAt.valueOf() - Date.parse(complete.generatedAt))
				: Number.POSITIVE_INFINITY;
			if (
				statusResult.status === "rejected" &&
				signalsResult.status === "rejected" &&
				complete &&
				completeAgeMs <= staleTtlMs
			) {
				return {
					...complete,
					cache: { ageMs: completeAgeMs, status: "STALE" },
					health: {
						...complete.health,
						dataState: "STALE",
						reasons: [...complete.health.reasons, "概览数据源暂时不可用，正在显示最近一次结果。"],
					},
				};
			}

			const status =
				statusResult.status === "fulfilled" ? statusResult.value : unavailableStatusOverview();
			const signals =
				signalsResult.status === "fulfilled" ? signalsResult.value : unavailableSignalsSnapshot();
			const issues = collectIssues(status, signals);
			const health = summarizeHealth(status, signals, issues);
			const response = OpsOverviewResponseSchema.parse({
				cache: { ageMs: 0, status: "FRESH" },
				externalLinks: status.externalLinks,
				generatedAt: requestedAt.toISOString(),
				health,
				issues,
				requests: status.requests,
				services: signals.services,
				telemetry: signals.telemetry,
				temporal: status.temporal,
				trends: status.trends,
				window,
			});
			responseCache.set(window, response);
			if (statusResult.status === "fulfilled" && signalsResult.status === "fulfilled") {
				completeCache.set(window, response);
			}
			return response;
		},
	};
}

function collectIssues(
	status: OpsStatusOverview,
	signals: OpsRuntimeSignalsSnapshot,
): OpsOverviewResponse["issues"] {
	const issues: OpsOverviewResponse["issues"] = [];
	if (status.requests.status === "OUTAGE" || status.requests.status === "DEGRADED") {
		issues.push({
			code: `REQUESTS_${status.requests.status}`,
			detail: status.requests.reason ?? "请求状态异常。",
			severity: status.requests.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "REQUESTS",
			title: status.requests.status === "OUTAGE" ? "请求大面积失败" : "存在失败请求",
		});
	}
	if (status.temporal.status !== "HEALTHY") {
		issues.push({
			code: `TEMPORAL_${status.temporal.status}`,
			detail: status.temporal.reason ?? "Temporal 队列状态不可用。",
			severity: status.temporal.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "TEMPORAL",
			title: "Temporal 队列需要处理",
		});
	}
	for (const service of signals.services) {
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
	if (signals.telemetry.status !== "HEALTHY") {
		issues.push({
			code: `TELEMETRY_${signals.telemetry.status}`,
			detail: signals.telemetry.reason ?? "日志、指标或调用链数据不可用。",
			severity: signals.telemetry.status === "OUTAGE" ? "CRITICAL" : "WARNING",
			source: "TELEMETRY",
			title: "日志、指标或调用链需要检查",
		});
	}
	return issues;
}

function summarizeHealth(
	status: OpsStatusOverview,
	signals: OpsRuntimeSignalsSnapshot,
	issues: OpsOverviewResponse["issues"],
): OpsOverviewResponse["health"] {
	const sources = [status.requests, status.temporal, signals.telemetry, ...signals.services].filter(
		(source) => !(source === status.requests && source.dataState === "NO_DATA"),
	);
	const statuses = sources.map((source) => source.status);
	let healthStatus: OpsHealthStatus;
	if (statuses.some((value) => value === "OUTAGE")) {
		healthStatus = "OUTAGE";
	} else if (statuses.some((value) => value === "DEGRADED")) {
		healthStatus = "DEGRADED";
	} else if (statuses.length > 0 && statuses.every((value) => value === "UNKNOWN")) {
		healthStatus = "UNKNOWN";
	} else if (statuses.some((value) => value === "UNKNOWN")) {
		healthStatus = "DEGRADED";
	} else {
		healthStatus = "HEALTHY";
	}
	const dataState = aggregateDataState(sources.map((source) => source.dataState));
	return {
		dataState,
		reasons: issues.map((issue) => issue.detail),
		status: healthStatus,
	};
}

function aggregateDataState(states: OpsDataState[]): OpsDataState {
	if (states.length === 0 || states.every((state) => state === "UNAVAILABLE")) {
		return "UNAVAILABLE";
	}
	if (states.some((state) => state === "STALE")) {
		return "STALE";
	}
	if (states.some((state) => state === "UNAVAILABLE")) {
		return "UNAVAILABLE";
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
		temporal: {
			backlogCount: 0,
			dataState: "UNAVAILABLE",
			oldestTaskAgeMs: null,
			pollerCount: 0,
			queues: [],
			reason: "Temporal 队列状态数据库不可用。",
			status: "UNKNOWN",
			updatedAt: null,
		},
		trends: [],
	};
}

function unavailableSignalsSnapshot(): OpsRuntimeSignalsSnapshot {
	return {
		services: REQUIRED_SERVICES.map(([name, displayName]) => ({
			dataState: "UNAVAILABLE" as const,
			displayName,
			name,
			reason: "健康检查数据不可用。",
			status: "UNKNOWN" as const,
			updatedAt: null,
		})),
		telemetry: {
			dataState: "UNAVAILABLE",
			reason: "Axiom 查询不可用。",
			signals: (["LOGS", "METRICS", "TRACES"] as const).map((kind) => ({
				dataState: "UNAVAILABLE" as const,
				kind,
				reason: "Axiom 查询不可用。",
				recordCount: null,
				status: "UNKNOWN" as const,
				updatedAt: null,
			})),
			status: "UNKNOWN",
			updatedAt: null,
		},
	};
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error("ops overview source timed out")), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}
