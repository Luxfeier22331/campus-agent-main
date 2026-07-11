import {
	type OpsObservabilityResponse,
	OpsObservabilityResponseSchema,
	type OpsOverviewResponse,
	type OpsOverviewWindow,
} from "../shared/ops-contract.ts";

const DEFAULT_LOG_STREAM = "campus_agent_logs";
const DEFAULT_METRIC_STREAM = "otelcol_process_uptime";
const DEFAULT_TRACE_STREAM = "campus_agent_traces";
const DEFAULT_TIMEOUT_MS = 5_000;
const QUERY_PADDING_MS = 5 * 60_000;
const STREAM_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

type OpenObserveStreamType = "logs" | "metrics" | "traces";

export type OpsObservabilityKind = OpsObservabilityResponse["kind"];

export interface OpenObserveQueryInput {
	completedAt: string | null;
	kind: OpsObservabilityKind;
	now?: Date;
	requestId: string;
	startedAt: string;
	traceId: string;
}

export interface OpenObserveClient {
	getTelemetrySnapshot(
		window: OpsOverviewWindow,
		now?: Date,
	): Promise<OpsOverviewResponse["telemetry"]>;
	queryRequest(input: OpenObserveQueryInput): Promise<OpsObservabilityResponse>;
}

export interface OpenObserveEnv {
	OPENOBSERVE_BASE_URL?: string;
	OPENOBSERVE_ORGANIZATION?: string;
	OPENOBSERVE_PASSWORD?: string;
	OPENOBSERVE_USERNAME?: string;
	OPS_WEB_OPENOBSERVE_LOG_STREAM?: string;
	OPS_WEB_OPENOBSERVE_METRIC_STREAM?: string;
	OPS_WEB_OPENOBSERVE_QUERY_TIMEOUT_MS?: string;
	OPS_WEB_OPENOBSERVE_TRACE_STREAM?: string;
}

export class OpenObserveUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "OpenObserveUnavailableError";
	}
}

export function createOpenObserveClient(input: {
	baseUrl: string;
	fetchFn?: typeof fetch;
	logStream?: string;
	metricStream?: string;
	organization: string;
	password: string;
	timeoutMs?: number;
	traceStream?: string;
	username: string;
}): OpenObserveClient {
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	const organization = normalizePathSegment(input.organization, "organization");
	const logStream = normalizeStreamName(input.logStream ?? DEFAULT_LOG_STREAM);
	const metricStream = normalizeStreamName(input.metricStream ?? DEFAULT_METRIC_STREAM);
	const traceStream = normalizeStreamName(input.traceStream ?? DEFAULT_TRACE_STREAM);
	const timeoutMs = normalizeTimeout(input.timeoutMs);
	const fetchFn = input.fetchFn ?? fetch;
	const authorization = `Basic ${Buffer.from(`${input.username}:${input.password}`, "utf8").toString("base64")}`;

	return {
		async getTelemetrySnapshot(window, requestedNow = new Date()) {
			const from = new Date(requestedNow.valueOf() - overviewWindowMs(window));
			const specs = [
				{ kind: "LOGS" as const, stream: logStream, type: "logs" as const },
				{ kind: "METRICS" as const, stream: metricStream, type: "metrics" as const },
				{ kind: "TRACES" as const, stream: traceStream, type: "traces" as const },
			];
			const results = await Promise.allSettled(
				specs.map(async (spec) => {
					const response = await fetchFn(searchUrl(baseUrl, organization, spec.type), {
						body: JSON.stringify({
							query: {
								end_time: requestedNow.valueOf() * 1_000,
								from: 0,
								size: 1,
								sql: `SELECT COUNT(*) AS record_count, MAX(_timestamp) AS last_seen_at FROM "${spec.stream}"`,
								start_time: from.valueOf() * 1_000,
							},
						}),
						headers: {
							accept: "application/json",
							authorization,
							"content-type": "application/json",
						},
						method: "POST",
						signal: AbortSignal.timeout(timeoutMs),
					});
					if (!response.ok) {
						throw new OpenObserveUnavailableError(
							`OpenObserve telemetry query returned HTTP ${response.status}.`,
						);
					}
					const payload = await parseSearchResponse(response);
					const row = payload.hits[0] ?? {};
					return {
						kind: spec.kind,
						lastSeenAt: normalizeTimestamp(row.last_seen_at ?? row.lastSeenAt),
						recordCount: normalizeCount(row.record_count ?? row.recordCount),
					};
				}),
			);
			const signals: OpsOverviewResponse["telemetry"]["signals"] = results.map((result, index) => {
				const kind = specs[index]?.kind ?? "LOGS";
				if (result.status === "rejected") {
					return {
						dataState: "UNAVAILABLE",
						kind,
						reason: "OpenObserve 流查询失败。",
						recordCount: null,
						status: "UNKNOWN",
						updatedAt: null,
					};
				}
				const hasData = result.value.recordCount > 0;
				const metricsMissing = kind === "METRICS" && !hasData;
				return {
					dataState: hasData ? "FRESH" : "NO_DATA",
					kind,
					reason: metricsMissing ? "当前窗口没有持续指标。" : null,
					recordCount: result.value.recordCount,
					status: metricsMissing ? "DEGRADED" : hasData ? "HEALTHY" : "UNKNOWN",
					updatedAt: result.value.lastSeenAt,
				};
			});
			const allUnavailable = signals.every((signal) => signal.dataState === "UNAVAILABLE");
			const anyUnavailable = signals.some((signal) => signal.dataState === "UNAVAILABLE");
			const anyDegraded = signals.some((signal) => signal.status === "DEGRADED");
			const updatedAt =
				signals
					.map((signal) => signal.updatedAt)
					.filter((value): value is string => Boolean(value))
					.sort()
					.at(-1) ?? null;
			return {
				dataState: allUnavailable ? "UNAVAILABLE" : anyUnavailable ? "UNAVAILABLE" : "FRESH",
				reason: allUnavailable
					? "OpenObserve 不可用。"
					: anyUnavailable
						? "部分观测数据流不可用。"
						: anyDegraded
							? "持续指标在当前窗口内缺失。"
							: null,
				signals,
				status: allUnavailable ? "UNKNOWN" : anyUnavailable || anyDegraded ? "DEGRADED" : "HEALTHY",
				updatedAt,
			};
		},
		async queryRequest(queryInput) {
			const limit = queryInput.kind === "logs" ? 200 : 500;
			const stream = queryInput.kind === "logs" ? logStream : traceStream;
			const streamType = queryInput.kind === "logs" ? "logs" : "traces";
			const now = queryInput.now ?? new Date();
			const from = new Date(Date.parse(queryInput.startedAt) - QUERY_PADDING_MS);
			const completedAt = queryInput.completedAt
				? Date.parse(queryInput.completedAt)
				: now.valueOf();
			const to = new Date(Math.min(now.valueOf(), completedAt + QUERY_PADDING_MS));
			const sql = [
				`SELECT * FROM "${stream}"`,
				`WHERE request_id = '${escapeSqlLiteral(queryInput.requestId)}'`,
				"ORDER BY _timestamp ASC",
			].join(" ");
			const startedAt = Date.now();
			let response: Response;
			try {
				response = await fetchFn(searchUrl(baseUrl, organization, streamType), {
					body: JSON.stringify({
						query: {
							end_time: to.valueOf() * 1_000,
							from: 0,
							size: limit + 1,
							sql,
							start_time: from.valueOf() * 1_000,
						},
					}),
					headers: {
						accept: "application/json",
						authorization,
						"content-type": "application/json",
					},
					method: "POST",
					signal: AbortSignal.timeout(timeoutMs),
				});
			} catch (error) {
				throw new OpenObserveUnavailableError("OpenObserve query failed.", { cause: error });
			}
			if (!response.ok) {
				throw new OpenObserveUnavailableError(
					`OpenObserve query returned HTTP ${response.status}.`,
				);
			}
			const payload = await parseSearchResponse(response);
			const records = payload.hits.slice(0, limit);
			return OpsObservabilityResponseSchema.parse({
				dataState: records.length === 0 ? "NO_DATA" : "FRESH",
				from: from.toISOString(),
				kind: queryInput.kind,
				limit,
				queriedAt: now.toISOString(),
				queryDurationMs: normalizeDuration(payload.took, Date.now() - startedAt),
				records,
				requestId: queryInput.requestId,
				source: "OPENOBSERVE",
				to: to.toISOString(),
				traceId: queryInput.traceId,
				truncated: payload.hits.length > limit || payload.total > limit,
			});
		},
	};
}

export function createOpenObserveClientFromEnv(
	env: OpenObserveEnv = process.env,
): OpenObserveClient {
	const required = {
		baseUrl: env.OPENOBSERVE_BASE_URL?.trim(),
		organization: env.OPENOBSERVE_ORGANIZATION?.trim(),
		password: env.OPENOBSERVE_PASSWORD,
		username: env.OPENOBSERVE_USERNAME?.trim(),
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new OpenObserveUnavailableError(
			`OpenObserve configuration is missing: ${missing.join(", ")}.`,
		);
	}
	return createOpenObserveClient({
		baseUrl: required.baseUrl as string,
		logStream: env.OPS_WEB_OPENOBSERVE_LOG_STREAM,
		metricStream: env.OPS_WEB_OPENOBSERVE_METRIC_STREAM,
		organization: required.organization as string,
		password: required.password as string,
		timeoutMs: normalizeEnvInteger(env.OPS_WEB_OPENOBSERVE_QUERY_TIMEOUT_MS),
		traceStream: env.OPS_WEB_OPENOBSERVE_TRACE_STREAM,
		username: required.username as string,
	});
}

function normalizeBaseUrl(value: string) {
	const parsed = new URL(value);
	if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
		throw new Error("OpenObserve base URL must use HTTP or HTTPS.");
	}
	return parsed.toString().replace(/\/$/, "");
}

function normalizePathSegment(value: string, label: string) {
	const normalized = value.trim();
	if (!(normalized && /^[A-Za-z0-9_-]+$/.test(normalized))) {
		throw new Error(`OpenObserve ${label} is invalid.`);
	}
	return normalized;
}

function normalizeStreamName(value: string) {
	const normalized = value.trim();
	if (!STREAM_NAME_PATTERN.test(normalized)) {
		throw new Error("OpenObserve stream name is invalid.");
	}
	return normalized;
}

function searchUrl(baseUrl: string, organization: string, streamType: OpenObserveStreamType) {
	return `${baseUrl}/api/${organization}/_search?type=${streamType}`;
}

function normalizeTimeout(value: number | undefined) {
	return Number.isInteger(value) && Number(value) > 0 ? Number(value) : DEFAULT_TIMEOUT_MS;
}

function normalizeEnvInteger(value: string | undefined): number | undefined {
	if (!value?.trim()) {
		return;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function escapeSqlLiteral(value: string) {
	return value.replaceAll("'", "''");
}

async function parseSearchResponse(response: Response): Promise<{
	hits: Record<string, unknown>[];
	took: number | null;
	total: number;
}> {
	let value: unknown;
	try {
		value = await response.json();
	} catch (error) {
		throw new OpenObserveUnavailableError("OpenObserve returned invalid JSON.", { cause: error });
	}
	if (!isRecord(value)) {
		throw new OpenObserveUnavailableError("OpenObserve returned an invalid search response.");
	}
	const rawHits = Array.isArray(value.hits)
		? value.hits
		: isRecord(value.hits) && Array.isArray(value.hits.hits)
			? value.hits.hits
			: null;
	if (!rawHits) {
		throw new OpenObserveUnavailableError("OpenObserve search response is missing hits.");
	}
	const hits = rawHits.filter(isRecord);
	const total =
		typeof value.total === "number" && Number.isFinite(value.total) ? value.total : hits.length;
	return {
		hits,
		took: typeof value.took === "number" && Number.isFinite(value.took) ? value.took : null,
		total: Math.max(0, Math.trunc(total)),
	};
}

function normalizeDuration(value: number | null, fallback: number) {
	return Math.max(0, Math.trunc(value ?? fallback));
}

function overviewWindowMs(window: OpsOverviewWindow) {
	return { "15m": 15 * 60_000, "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "6h": 6 * 60 * 60_000 }[
		window
	];
}

function normalizeCount(value: unknown) {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "0"), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function normalizeTimestamp(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const milliseconds = value > 10_000_000_000_000 ? value / 1_000 : value;
		return new Date(milliseconds).toISOString();
	}
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
