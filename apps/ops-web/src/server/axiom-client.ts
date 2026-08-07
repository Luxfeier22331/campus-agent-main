import {
	AxiomWithoutBatching,
	type MetricsQueryOptions,
	type MetricsResult,
	type TabularQueryResult,
} from "@axiomhq/js";

import {
	type OpsObservabilityResponse,
	OpsObservabilityResponseSchema,
	type OpsOverviewResponse,
	type OpsOverviewWindow,
	type TelemetryCoverageEntry,
} from "../shared/ops-contract.ts";
import { raceWithSignal } from "./race-with-signal.ts";
import { resolveRequestObservabilityWindow } from "./request-observability-window.ts";

const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EDGE_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const COLLECTOR_HEARTBEAT_WINDOW_MS = 10 * 60_000;
const MAX_ACTIVE_AXIOM_QUERIES = 5;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type OpsObservabilityKind = OpsObservabilityResponse["kind"];

export interface AxiomQueryInput {
	completedAt: string | null;
	kind: OpsObservabilityKind;
	now?: Date;
	requestId: string;
	signal?: AbortSignal;
	startedAt: string;
	traceId: string;
}

export interface AxiomTelemetrySnapshotInput {
	now?: Date;
	signal?: AbortSignal;
}

export interface AxiomClient {
	getTelemetrySnapshot(
		window: OpsOverviewWindow,
		input?: AxiomTelemetrySnapshotInput,
	): Promise<OpsOverviewResponse["telemetry"]>;
	queryRequest(input: AxiomQueryInput): Promise<OpsObservabilityResponse>;
}

export interface AxiomEnv {
	AXIOM_QUERY_TOKEN?: string;
	OPS_WEB_AXIOM_EDGE_DOMAIN?: string;
	OPS_WEB_AXIOM_LOGS_DATASET?: string;
	OPS_WEB_AXIOM_METRICS_DATASET?: string;
	OPS_WEB_AXIOM_TRACES_DATASET?: string;
}

export interface AxiomSdkQueryClient {
	query(
		apl: string,
		options: { endTime: string; format: "tabular"; startTime: string },
	): Promise<TabularQueryResult>;
	query(mpl: string, options: MetricsQueryOptions): Promise<MetricsResult>;
}

export class AxiomUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AxiomUnavailableError";
	}
}

interface AxiomQueryObservation {
	blocksExamined: number | null;
	dataset: string;
	elapsedTime: number | null;
	rowsExamined: number | null;
}

interface ParsedTabularResponse {
	records: Record<string, unknown>[];
	rowsMatched: number | null;
}

const COLLECTOR_PRODUCERS = ["otel-collector-agent", "otel-collector-gateway"] as const;

export function createAxiomClient(input: {
	edgeDomain: string;
	logsDataset: string;
	metricsDataset: string;
	onQueryComplete?: (observation: AxiomQueryObservation) => void;
	queryToken: string;
	sdkClient?: AxiomSdkQueryClient;
	tracesDataset: string;
}): AxiomClient {
	const edgeDomain = normalizeEdgeDomain(input.edgeDomain);
	const datasets = {
		logs: normalizeDatasetName(input.logsDataset),
		metrics: normalizeDatasetName(input.metricsDataset),
		traces: normalizeDatasetName(input.tracesDataset),
	};
	const queryToken = normalizeQueryToken(input.queryToken);
	const sdkClient: AxiomSdkQueryClient =
		input.sdkClient ??
		new AxiomWithoutBatching({
			axiomClient: "campus-agent-ops-web",
			edge: edgeDomain,
			token: queryToken,
		});
	const onQueryComplete =
		input.onQueryComplete ??
		((observation: AxiomQueryObservation) => {
			console.info("[ops-web] axiom query completed", observation);
		});
	let activeQueryCount = 0;

	async function runSdkQuery<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
		if (signal?.aborted) {
			throw new AxiomUnavailableError("Axiom query was aborted before it started.", {
				cause: signal.reason,
			});
		}
		if (activeQueryCount >= MAX_ACTIVE_AXIOM_QUERIES) {
			throw new AxiomUnavailableError("Axiom query concurrency limit was reached.");
		}
		activeQueryCount += 1;
		// The SDK has no caller-provided AbortSignal, so retain the slot until its request settles.
		const sdkQuery = Promise.resolve()
			.then(operation)
			.finally(() => {
				activeQueryCount -= 1;
			});
		try {
			return await raceWithSignal(sdkQuery, signal);
		} catch (error) {
			throw new AxiomUnavailableError("Axiom query failed.", { cause: error });
		}
	}

	async function runAplQuery(query: {
		apl: string;
		dataset: string;
		from: Date;
		signal?: AbortSignal;
		to: Date;
	}): Promise<ParsedTabularResponse> {
		const result = await runSdkQuery(
			() =>
				sdkClient.query(query.apl, {
					endTime: query.to.toISOString(),
					format: "tabular",
					startTime: query.from.toISOString(),
				}),
			query.signal,
		);
		if (result.status.isPartial !== false) {
			throw new AxiomUnavailableError("Axiom returned a partial query result.");
		}
		let records: Record<string, unknown>[];
		try {
			records = result.tables.flatMap((table) => [...table.events()]);
		} catch (error) {
			throw new AxiomUnavailableError("Axiom returned an invalid tabular result.", {
				cause: error,
			});
		}
		onQueryComplete({
			blocksExamined: optionalNonNegativeNumber(result.status.blocksExamined),
			dataset: query.dataset,
			elapsedTime: optionalNonNegativeNumber(result.status.elapsedTime),
			rowsExamined: optionalNonNegativeNumber(result.status.rowsExamined),
		});
		return {
			records,
			rowsMatched: optionalNonNegativeNumber(result.status.rowsMatched),
		};
	}

	async function runMetricsQuery(query: {
		dataset: string;
		from: Date;
		signal?: AbortSignal;
		to: Date;
	}) {
		const startedAt = Date.now();
		const result = await runSdkQuery(
			() =>
				sdkClient.query(buildAxiomMetricsMpl(query.dataset), {
					endTime: query.to.toISOString(),
					format: "metrics-v2",
					startTime: query.from.toISOString(),
					type: "mpl",
				}),
			query.signal,
		);
		const snapshot = parseMetricsCoverage(result);
		onQueryComplete({
			blocksExamined: null,
			dataset: query.dataset,
			elapsedTime: Date.now() - startedAt,
			rowsExamined: snapshot.reduce((total, entry) => total + entry.recordCount, 0),
		});
		return snapshot;
	}

	return {
		async getTelemetrySnapshot(window, queryInput = {}) {
			const requestedNow = queryInput.now ?? new Date();
			const activityFrom = new Date(requestedNow.valueOf() - overviewWindowMs(window));
			const metricsFrom = new Date(requestedNow.valueOf() - COLLECTOR_HEARTBEAT_WINDOW_MS);
			const specs = [
				{ dataset: datasets.logs, expectation: "ACTIVITY" as const, kind: "LOGS" as const },
				{ dataset: datasets.metrics, expectation: "CONTINUOUS" as const, kind: "METRICS" as const },
				{ dataset: datasets.traces, expectation: "ACTIVITY" as const, kind: "TRACES" as const },
			];
			const results = await Promise.allSettled(
				specs.map(async (spec) => {
					if (spec.kind === "METRICS") {
						return runMetricsQuery({
							dataset: spec.dataset,
							from: metricsFrom,
							signal: queryInput.signal,
							to: requestedNow,
						});
					}
					const payload = await runAplQuery({
						apl: buildAxiomActivityCoverageApl(spec.dataset),
						dataset: spec.dataset,
						from: activityFrom,
						signal: queryInput.signal,
						to: requestedNow,
					});
					return parseActivityCoverage(payload.records);
				}),
			);
			if (queryInput.signal?.aborted) {
				throw new AxiomUnavailableError("Axiom telemetry query was aborted.", {
					cause: queryInput.signal.reason,
				});
			}
			const signals: OpsOverviewResponse["telemetry"]["signals"] = results.flatMap(
				(result, index) => {
					const spec = specs[index] ?? specs[0];
					if (!spec) {
						return [];
					}
					if (result.status === "rejected") {
						return [
							{
								dataState: "UNAVAILABLE",
								expectation: spec.expectation,
								kind: spec.kind,
								producer: { instanceId: null, nodeName: null, serviceName: null },
								reason: "Axiom 数据集查询失败。",
								recordCount: null,
								status: "UNKNOWN",
								updatedAt: null,
							},
						] satisfies TelemetryCoverageEntry[];
					}
					if (spec.kind === "METRICS") {
						return collectorCoverageEntries(result.value);
					}
					if (result.value.length === 0) {
						return [
							{
								dataState: "NO_DATA",
								expectation: "ACTIVITY",
								kind: spec.kind,
								producer: { instanceId: null, nodeName: null, serviceName: null },
								reason: null,
								recordCount: 0,
								status: "UNKNOWN",
								updatedAt: null,
							},
						] satisfies TelemetryCoverageEntry[];
					}
					return result.value.map((entry) => ({
						dataState: entry.recordCount > 0 ? "FRESH" : "NO_DATA",
						expectation: "ACTIVITY",
						kind: spec.kind,
						producer: {
							instanceId: entry.instanceId,
							nodeName: entry.nodeName,
							serviceName: entry.serviceName,
						},
						reason: null,
						recordCount: entry.recordCount,
						status: entry.recordCount > 0 ? "HEALTHY" : "UNKNOWN",
						updatedAt: entry.lastSeenAt,
					})) satisfies TelemetryCoverageEntry[];
				},
			);
			const allUnavailable = signals.every((signal) => signal.dataState === "UNAVAILABLE");
			const anyUnavailable = signals.some((signal) => signal.dataState === "UNAVAILABLE");
			const allNoData = signals.every((signal) => signal.dataState === "NO_DATA");
			const anyDegraded = signals.some((signal) => signal.status === "DEGRADED");
			const updatedAt =
				signals
					.map((signal) => signal.updatedAt)
					.filter((value): value is string => Boolean(value))
					.sort()
					.at(-1) ?? null;
			return {
				dataState: allUnavailable
					? "UNAVAILABLE"
					: anyUnavailable
						? "PARTIAL"
						: allNoData
							? "NO_DATA"
							: "FRESH",
				reason: allUnavailable
					? "Axiom 不可用。"
					: anyUnavailable
						? "部分观测数据集不可用。"
						: anyDegraded
							? "持续指标在最近十分钟内缺失。"
							: null,
				signals,
				status: allUnavailable ? "UNKNOWN" : anyUnavailable || anyDegraded ? "DEGRADED" : "HEALTHY",
				updatedAt,
			};
		},
		async queryRequest(queryInput) {
			const limit = queryInput.kind === "logs" ? 200 : 500;
			const dataset = queryInput.kind === "logs" ? datasets.logs : datasets.traces;
			const now = queryInput.now ?? new Date();
			let window: ReturnType<typeof resolveRequestObservabilityWindow>;
			try {
				window = resolveRequestObservabilityWindow(queryInput, now);
			} catch (error) {
				throw new AxiomUnavailableError("Axiom query received an invalid request time range.", {
					cause: error,
				});
			}
			const startedAt = Date.now();
			const payload = await runAplQuery({
				apl: buildAxiomRequestApl({
					dataset,
					kind: queryInput.kind,
					limit: limit + 1,
					requestId: queryInput.requestId,
				}),
				dataset,
				from: window.from,
				signal: queryInput.signal,
				to: window.to,
			});
			const records = payload.records
				.slice(0, limit)
				.map((record) => mapAxiomRecord(queryInput.kind, record));
			return OpsObservabilityResponseSchema.parse({
				dataState: records.length === 0 ? "NO_DATA" : "FRESH",
				from: window.from.toISOString(),
				kind: queryInput.kind,
				limit,
				queriedAt: now.toISOString(),
				queryDurationMs: Math.max(0, Date.now() - startedAt),
				records,
				requestId: queryInput.requestId,
				source: "AXIOM",
				to: window.to.toISOString(),
				traceId: queryInput.traceId,
				truncated:
					window.clamped ||
					payload.records.length > limit ||
					(payload.rowsMatched !== null && payload.rowsMatched > limit),
			});
		},
	};
}

export function createAxiomClientFromEnv(env: AxiomEnv = process.env): AxiomClient {
	const required = {
		AXIOM_QUERY_TOKEN: env.AXIOM_QUERY_TOKEN?.trim(),
		OPS_WEB_AXIOM_EDGE_DOMAIN: env.OPS_WEB_AXIOM_EDGE_DOMAIN?.trim(),
		OPS_WEB_AXIOM_LOGS_DATASET: env.OPS_WEB_AXIOM_LOGS_DATASET?.trim(),
		OPS_WEB_AXIOM_METRICS_DATASET: env.OPS_WEB_AXIOM_METRICS_DATASET?.trim(),
		OPS_WEB_AXIOM_TRACES_DATASET: env.OPS_WEB_AXIOM_TRACES_DATASET?.trim(),
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new AxiomUnavailableError(`Axiom configuration is missing: ${missing.join(", ")}.`);
	}
	return createAxiomClient({
		edgeDomain: required.OPS_WEB_AXIOM_EDGE_DOMAIN as string,
		logsDataset: required.OPS_WEB_AXIOM_LOGS_DATASET as string,
		metricsDataset: required.OPS_WEB_AXIOM_METRICS_DATASET as string,
		queryToken: required.AXIOM_QUERY_TOKEN as string,
		tracesDataset: required.OPS_WEB_AXIOM_TRACES_DATASET as string,
	});
}

export function buildAxiomActivityCoverageApl(dataset: string) {
	const normalizedDataset = normalizeDatasetName(dataset);
	return [
		`['${normalizedDataset}']`,
		"| summarize record_count = count(), last_seen_at = max(_time) by service_name = tostring(['service.name'])",
		"| project service_name, record_count, last_seen_at",
		"| sort by service_name asc",
	].join("\n");
}

export function buildAxiomMetricsMpl(dataset: string) {
	const normalizedDataset = normalizeDatasetName(dataset);
	return [
		`\`${normalizedDataset}\`:\`otelcol_process_uptime\``,
		"| group by `service.name`, `service.instance.id`, `k8s.node.name` using max",
	].join("\n");
}

export function buildAxiomRequestApl(input: {
	dataset: string;
	kind: OpsObservabilityKind;
	limit: number;
	requestId: string;
}) {
	const dataset = normalizeDatasetName(input.dataset);
	const requestId = normalizeRequestId(input.requestId);
	if (!(Number.isInteger(input.limit) && input.limit > 0 && input.limit <= 501)) {
		throw new Error("Axiom query limit is invalid.");
	}
	const quotedRequestId = JSON.stringify(requestId);
	const requestAttribute = "tostring(['attributes.custom']['campus.request_id'])";
	const requestBody = "tostring(body['campus.request_id'])";
	const predicate =
		input.kind === "logs"
			? `${requestAttribute} == ${quotedRequestId} or ${requestBody} == ${quotedRequestId}`
			: `${requestAttribute} == ${quotedRequestId}`;
	const projection =
		input.kind === "logs"
			? [
					"timestamp = _time",
					"serviceName = ['service.name']",
					"severityText = tostring(coalesce(severity_text, severityText, severity))",
					"eventType = tostring(coalesce(['attributes.custom']['event.name'], ['attributes.custom']['event_type'], body['event_type']))",
					"source = tostring(coalesce(['attributes.custom']['source'], body['source']))",
					"status = tostring(coalesce(['attributes.custom']['status'], body['status']))",
					"errorCode = tostring(coalesce(['attributes.custom']['error.code'], ['attributes.custom']['error_code'], body['error_code']))",
					"durationMs = todouble(coalesce(['attributes.custom']['duration_ms'], body['duration_ms']))",
					"otelTraceId = tostring(trace_id)",
					"otelSpanId = tostring(span_id)",
					"requestId = tostring(coalesce(['attributes.custom']['campus.request_id'], body['campus.request_id']))",
					"productTraceId = tostring(coalesce(['attributes.custom']['campus.trace_id'], body['campus.trace_id']))",
				]
			: [
					"timestamp = _time",
					"serviceName = ['service.name']",
					"name",
					"kind = tostring(kind)",
					"duration = tostring(duration)",
					"statusCode = tostring(['status.code'])",
					"hasError = error",
					"otelTraceId = tostring(trace_id)",
					"otelSpanId = tostring(span_id)",
					"parentSpanId = tostring(parent_span_id)",
					"requestId = tostring(['attributes.custom']['campus.request_id'])",
					"productTraceId = tostring(['attributes.custom']['campus.trace_id'])",
				];
	return [
		`['${dataset}']`,
		`| where ${predicate}`,
		`| project ${projection.join(", ")}`,
		"| sort by timestamp asc",
		`| take ${input.limit}`,
	].join("\n");
}

function normalizeEdgeDomain(value: string) {
	const normalized = value.trim().toLowerCase();
	if (
		!EDGE_DOMAIN_PATTERN.test(normalized) ||
		normalized.includes("..") ||
		normalized.includes(":") ||
		normalized.includes("/")
	) {
		throw new Error("Axiom Edge domain is invalid.");
	}
	return normalized;
}

function normalizeDatasetName(value: string) {
	const normalized = value.trim();
	if (!DATASET_NAME_PATTERN.test(normalized)) {
		throw new Error("Axiom dataset name is invalid.");
	}
	return normalized;
}

function normalizeRequestId(value: string) {
	const normalized = value.trim();
	if (!REQUEST_ID_PATTERN.test(normalized)) {
		throw new Error("Axiom request ID is invalid.");
	}
	return normalized;
}

function normalizeQueryToken(value: string) {
	const normalized = value.trim();
	if (!normalized || /[\r\n]/.test(normalized)) {
		throw new Error("Axiom query token is invalid.");
	}
	if (normalized.startsWith("xapt-")) {
		throw new Error("Axiom personal tokens are not allowed.");
	}
	return normalized;
}

function parseMetricsCoverage(result: MetricsResult) {
	if (!(isRecord(result) && Array.isArray(result.series))) {
		throw new AxiomUnavailableError("Axiom returned an invalid metrics result.");
	}
	return result.series.map((value) => {
		if (!isRecord(value)) {
			throw new AxiomUnavailableError("Axiom returned an invalid metrics series.");
		}
		const series = value as Record<string, unknown>;
		if (
			typeof series.metric !== "string" ||
			series.metric !== "otelcol_process_uptime" ||
			typeof series.start !== "number" ||
			!Number.isFinite(series.start) ||
			typeof series.resolution !== "number" ||
			!Number.isFinite(series.resolution) ||
			series.resolution <= 0 ||
			!Array.isArray(series.data)
		) {
			throw new AxiomUnavailableError("Axiom returned an invalid metrics series.");
		}
		if (!isRecord(series.tags)) {
			throw new AxiomUnavailableError("Axiom metrics series is missing its producer tags.");
		}
		const tags = series.tags as Record<string, unknown>;
		for (const [tagName, tagValue] of Object.entries(tags)) {
			if (tagValue !== null && typeof tagValue !== "string") {
				throw new AxiomUnavailableError(
					`Axiom metrics producer tag ${tagName} has an invalid type.`,
				);
			}
		}
		let recordCount = 0;
		let lastSeenSeconds: number | null = null;
		for (const [index, sample] of series.data.entries()) {
			if (sample !== null && (typeof sample !== "number" || !Number.isFinite(sample))) {
				throw new AxiomUnavailableError("Axiom metrics series contains an invalid sample.");
			}
			if (sample === null) {
				continue;
			}
			recordCount += 1;
			const timestamp = series.start + index * series.resolution;
			if (!(Number.isFinite(timestamp) && isValidUnixSeconds(timestamp))) {
				throw new AxiomUnavailableError("Axiom metrics series contains an invalid timestamp.");
			}
			lastSeenSeconds = lastSeenSeconds === null ? timestamp : Math.max(lastSeenSeconds, timestamp);
		}
		return {
			instanceId: nullableString(tags["service.instance.id"]),
			lastSeenAt: lastSeenSeconds === null ? null : new Date(lastSeenSeconds * 1_000).toISOString(),
			nodeName: nullableString(tags["k8s.node.name"]),
			recordCount,
			serviceName: nullableString(tags["service.name"]),
		};
	});
}

function parseActivityCoverage(records: Record<string, unknown>[]) {
	return records.map((row) => {
		if (!isRecord(row)) {
			throw new AxiomUnavailableError("Axiom returned an invalid activity coverage row.");
		}
		const recordCount = parseRecordCount(row.record_count);
		const lastSeenAt = parseActivityTimestamp(row.last_seen_at, recordCount);
		return {
			instanceId: null,
			lastSeenAt,
			nodeName: null,
			recordCount,
			serviceName: parseNullableString(row.service_name, "service_name"),
		};
	});
}

function collectorCoverageEntries(
	entries: ReturnType<typeof parseMetricsCoverage>,
): TelemetryCoverageEntry[] {
	const activeEntries = entries.filter((entry) => entry.recordCount > 0);
	const coverage: TelemetryCoverageEntry[] = activeEntries.map(
		(entry) =>
			({
				dataState: "FRESH",
				expectation: "CONTINUOUS",
				kind: "METRICS",
				producer: {
					instanceId: entry.instanceId,
					nodeName: entry.nodeName,
					serviceName: entry.serviceName,
				},
				reason: null,
				recordCount: entry.recordCount,
				status: "HEALTHY",
				updatedAt: entry.lastSeenAt,
			}) satisfies TelemetryCoverageEntry,
	);
	for (const serviceName of COLLECTOR_PRODUCERS) {
		if (activeEntries.some((entry) => entry.serviceName === serviceName)) {
			continue;
		}
		coverage.push({
			dataState: "NO_DATA",
			expectation: "CONTINUOUS",
			kind: "METRICS",
			producer: { instanceId: null, nodeName: null, serviceName },
			reason: `${serviceName === "otel-collector-agent" ? "Agent" : "Gateway"} Collector 在最近十分钟没有持续指标。`,
			recordCount: 0,
			status: "DEGRADED",
			updatedAt: null,
		});
	}
	return coverage;
}

function mapAxiomRecord(kind: OpsObservabilityKind, record: Record<string, unknown>) {
	const base = {
		otelSpanId: nullableString(record.otelSpanId),
		otelTraceId: nullableString(record.otelTraceId),
		productTraceId: nullableString(record.productTraceId),
		requestId: requiredString(record.requestId, "requestId"),
		serviceName: nullableString(record.serviceName),
		timestamp: requiredTimestamp(record.timestamp),
	};
	if (kind === "logs") {
		return {
			...base,
			durationMs: nullableNonNegativeNumber(record.durationMs),
			errorCode: nullableString(record.errorCode),
			eventType: nullableString(record.eventType),
			severityText: nullableString(record.severityText),
			source: nullableString(record.source),
			status: nullableString(record.status),
		};
	}
	return {
		...base,
		duration: nullableString(record.duration),
		hasError: nullableBoolean(record.hasError),
		kind: nullableString(record.kind),
		name: nullableString(record.name),
		otelSpanId: requiredString(record.otelSpanId, "otelSpanId"),
		otelTraceId: requiredString(record.otelTraceId, "otelTraceId"),
		parentSpanId: nullableString(record.parentSpanId),
		statusCode: nullableString(record.statusCode),
	};
}

function requiredString(value: unknown, field: string) {
	const normalized = nullableString(value);
	if (!normalized) {
		throw new AxiomUnavailableError(`Axiom record is missing ${field}.`);
	}
	return normalized;
}

function nullableString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	return value.trim() || null;
}

function requiredTimestamp(value: unknown): string {
	const normalized = normalizeTimestamp(value);
	if (!normalized) {
		throw new AxiomUnavailableError("Axiom record is missing a valid timestamp.");
	}
	return normalized;
}

function nullableNonNegativeNumber(value: unknown): number | null {
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nullableBoolean(value: unknown): boolean | null {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}
	return null;
}

function optionalNonNegativeNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function overviewWindowMs(window: OpsOverviewWindow) {
	return { "15m": 15 * 60_000, "1h": 60 * 60_000, "24h": 24 * 60 * 60_000, "6h": 6 * 60 * 60_000 }[
		window
	];
}

function parseRecordCount(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new AxiomUnavailableError("Axiom activity coverage returned an invalid record count.");
	}
	return value;
}

function parseNullableString(value: unknown, field: string): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string") {
		throw new AxiomUnavailableError(`Axiom activity coverage field ${field} has an invalid type.`);
	}
	return value.trim() || null;
}

function parseActivityTimestamp(value: unknown, recordCount: number): string | null {
	if (value === undefined || value === null) {
		if (recordCount > 0) {
			throw new AxiomUnavailableError(
				"Axiom activity coverage is missing last_seen_at for a non-empty service.",
			);
		}
		return null;
	}
	const normalized = normalizeTimestamp(value);
	if (!normalized) {
		throw new AxiomUnavailableError("Axiom activity coverage returned an invalid last_seen_at.");
	}
	return normalized;
}

function isValidUnixSeconds(value: number): boolean {
	const date = new Date(value * 1_000);
	return Number.isFinite(date.valueOf());
}

function normalizeTimestamp(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const magnitude = Math.abs(value);
		const milliseconds =
			magnitude >= 100_000_000_000_000_000
				? value / 1_000_000
				: magnitude >= 100_000_000_000_000
					? value / 1_000
					: magnitude < 100_000_000_000
						? value * 1_000
						: value;
		const parsed = new Date(milliseconds);
		return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
	}
	if (typeof value !== "string" || !value.trim()) {
		return null;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
