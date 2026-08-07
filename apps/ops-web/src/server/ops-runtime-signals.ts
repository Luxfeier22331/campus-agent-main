import type { OpsOverviewResponse, OpsOverviewWindow } from "../shared/ops-contract.ts";
import type { AxiomClient } from "./axiom-client.ts";
import type { OpsRuntimeSignalsSource } from "./ops-overview-service.ts";

const DEFAULT_HEALTH_TIMEOUT_MS = 1_500;
const SERVICE_DEFINITIONS = [
	["campus-web", "学生端"],
	["app-api", "浏览器接口"],
	["execution-control", "执行控制"],
	["agent-runtime", "Agent 运行服务"],
] as const;

export type OpsHealthServiceName = (typeof SERVICE_DEFINITIONS)[number][0];

export function createOpsRuntimeSignalsSource(input: {
	axiom: AxiomClient;
	fetchFn?: typeof fetch;
	healthTimeoutMs?: number;
	healthUrls: Partial<Record<OpsHealthServiceName, string>>;
	internalToken?: string;
	now?: () => Date;
}): OpsRuntimeSignalsSource {
	const fetchFn = input.fetchFn ?? fetch;
	const now = input.now ?? (() => new Date());
	const healthTimeoutMs = input.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;

	return {
		async getServices(queryInput = {}) {
			const checkedAt = now();
			return Promise.all(
				SERVICE_DEFINITIONS.flatMap(([name, displayName]) => {
					const url = normalizeHealthUrl(input.healthUrls[name]);
					return url
						? [
								checkService({
									checkedAt,
									displayName,
									fetchFn,
									internalToken: input.internalToken,
									name,
									signal: queryInput.signal,
									timeoutMs: healthTimeoutMs,
									url,
								}),
							]
						: [];
				}),
			);
		},
		async getTelemetry(window, queryInput = {}) {
			return readTelemetry(input.axiom, window, now(), queryInput.signal);
		},
	};
}

async function checkService(input: {
	checkedAt: Date;
	displayName: string;
	fetchFn: typeof fetch;
	internalToken?: string;
	name: OpsHealthServiceName;
	signal?: AbortSignal;
	timeoutMs: number;
	url: string;
}): Promise<OpsOverviewResponse["services"][number]> {
	input.signal?.throwIfAborted();
	try {
		const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
		const headers: Record<string, string> = { accept: "application/json" };
		if (input.name === "execution-control" && input.internalToken?.trim()) {
			headers.authorization = `Bearer ${input.internalToken.trim()}`;
		}
		const response = await input.fetchFn(input.url, {
			headers,
			method: "GET",
			signal: input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal,
		});
		const readiness = await readReadinessBody(response);
		if (response.ok && readiness.isReady) {
			return {
				dataState: "FRESH",
				displayName: input.displayName,
				name: input.name,
				reason: null,
				status: "HEALTHY",
				updatedAt: input.checkedAt.toISOString(),
			};
		}
		if (response.status >= 500 && readiness.isJsonObject) {
			return {
				dataState: "FRESH",
				displayName: input.displayName,
				name: input.name,
				reason: `健康检查返回 HTTP ${response.status}。`,
				status: "OUTAGE",
				updatedAt: input.checkedAt.toISOString(),
			};
		}
		return {
			dataState: "UNAVAILABLE",
			displayName: input.displayName,
			name: input.name,
			reason: response.ok ? "健康检查响应无效。" : `健康检查无法读取（HTTP ${response.status}）。`,
			status: "UNKNOWN",
			updatedAt: null,
		};
	} catch (error) {
		if (input.signal?.aborted) {
			throw error;
		}
		return {
			dataState: "UNAVAILABLE",
			displayName: input.displayName,
			name: input.name,
			reason: "健康检查连接失败或超时。",
			status: "UNKNOWN",
			updatedAt: null,
		};
	}
}

async function readReadinessBody(response: Response) {
	try {
		const body: unknown = await response.json();
		const isJsonObject = typeof body === "object" && body !== null && !Array.isArray(body);
		const status = isJsonObject ? Reflect.get(body, "status") : null;
		return { isJsonObject, isReady: status === "ok" || status === "ready" };
	} catch {
		return { isJsonObject: false, isReady: false };
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
				expectation: kind === "METRICS" ? ("CONTINUOUS" as const) : ("ACTIVITY" as const),
				kind,
				producer: { instanceId: null, nodeName: null, serviceName: null },
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
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		) {
			return null;
		}
		return new URL("/readyz", url).toString();
	} catch {
		return null;
	}
}
