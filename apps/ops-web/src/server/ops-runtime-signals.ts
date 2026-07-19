import type { OpsOverviewResponse, OpsOverviewWindow } from "../shared/ops-contract.ts";
import type { AxiomClient } from "./axiom-client.ts";
import type { OpsRuntimeSignalsSnapshot, OpsRuntimeSignalsSource } from "./ops-overview-service.ts";

const DEFAULT_HEALTH_TIMEOUT_MS = 1_500;
const SERVICE_DEFINITIONS = [
	["campus-web", "学生端"],
	["app-api", "浏览器接口"],
	["execution-control", "执行控制"],
	["agent-runtime", "Agent 运行服务"],
	["ops-web", "运维工作台"],
] as const;

export type OpsHealthServiceName = (typeof SERVICE_DEFINITIONS)[number][0];

export function createOpsRuntimeSignalsSource(input: {
	axiom: AxiomClient;
	fetchFn?: typeof fetch;
	healthTimeoutMs?: number;
	healthUrls: Partial<Record<OpsHealthServiceName, string>>;
	now?: () => Date;
}): OpsRuntimeSignalsSource {
	const fetchFn = input.fetchFn ?? fetch;
	const now = input.now ?? (() => new Date());
	const healthTimeoutMs = input.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

	return {
		async getSnapshot(window, queryInput = {}) {
			const checkedAt = now();
			const [services, telemetry] = await Promise.all([
				Promise.all(
					SERVICE_DEFINITIONS.map(([name, displayName]) =>
						checkService({
							checkedAt,
							displayName,
							fetchFn,
							name,
							signal: queryInput.signal,
							timeoutMs: healthTimeoutMs,
							url: input.healthUrls[name],
						}),
					),
				),
				readTelemetry(input.axiom, window, checkedAt, queryInput.signal),
			]);
			return { services, telemetry } satisfies OpsRuntimeSignalsSnapshot;
		},
	};
}

async function checkService(input: {
	checkedAt: Date;
	displayName: string;
	fetchFn: typeof fetch;
	name: OpsHealthServiceName;
	signal?: AbortSignal;
	timeoutMs: number;
	url: string | undefined;
}): Promise<OpsOverviewResponse["services"][number]> {
	input.signal?.throwIfAborted();
	const url = normalizeHealthUrl(input.url);
	if (!url) {
		return {
			dataState: "UNAVAILABLE",
			displayName: input.displayName,
			name: input.name,
			reason: "未配置健康检查地址。",
			status: "UNKNOWN",
			updatedAt: null,
		};
	}
	try {
		const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
		const response = await input.fetchFn(url, {
			headers: { accept: "application/json" },
			method: "GET",
			signal: input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal,
		});
		return {
			dataState: "FRESH",
			displayName: input.displayName,
			name: input.name,
			reason: response.ok ? null : `健康检查返回 HTTP ${response.status}。`,
			status: response.ok ? "HEALTHY" : "OUTAGE",
			updatedAt: input.checkedAt.toISOString(),
		};
	} catch (error) {
		if (input.signal?.aborted) {
			throw error;
		}
		return {
			dataState: "FRESH",
			displayName: input.displayName,
			name: input.name,
			reason: "健康检查连接失败或超时。",
			status: "OUTAGE",
			updatedAt: input.checkedAt.toISOString(),
		};
	}
}

async function readTelemetry(
	axiom: AxiomClient,
	window: OpsOverviewWindow,
	now: Date,
	signal?: AbortSignal,
): Promise<OpsOverviewResponse["telemetry"]> {
	try {
		return await axiom.getTelemetrySnapshot(window, { now, signal });
	} catch (error) {
		if (signal?.aborted) {
			throw error;
		}
		return {
			dataState: "UNAVAILABLE",
			reason: "Axiom 查询失败。",
			signals: (["LOGS", "METRICS", "TRACES"] as const).map((kind) => ({
				dataState: "UNAVAILABLE" as const,
				kind,
				reason: "Axiom 查询失败。",
				recordCount: null,
				status: "UNKNOWN" as const,
				updatedAt: null,
			})),
			status: "UNKNOWN",
			updatedAt: null,
		};
	}
}

function normalizeHealthUrl(value: string | undefined) {
	if (!value?.trim()) {
		return null;
	}
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
	} catch {
		return null;
	}
}
