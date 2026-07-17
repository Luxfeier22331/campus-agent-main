import {
	type OpsObservabilityResponse,
	OpsObservabilityResponseSchema,
	type OpsOverviewResponse,
	type OpsOverviewWindow,
} from "../shared/ops-contract.ts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const QUERY_PADDING_MS = 5 * 60_000;
const MAX_REQUEST_QUERY_WINDOW_MS = 30 * 60_000;
const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type OpsObservabilityKind = OpsObservabilityResponse["kind"];

export interface AxiomQueryInput {
	completedAt: string | null;
	kind: OpsObservabilityKind;
	now?: Date;
	requestId: string;
	startedAt: string;
	traceId: string;
}

export interface AxiomClient {
	getTelemetrySnapshot(
		window: OpsOverviewWindow,
		now?: Date,
	): Promise<OpsOverviewResponse["telemetry"]>;
	queryRequest(input: AxiomQueryInput): Promise<OpsObservabilityResponse>;
}

export interface AxiomEnv {
	OPS_WEB_AXIOM_EDGE_URL?: string;
	OPS_WEB_AXIOM_LOGS_DATASET?: string;
	OPS_WEB_AXIOM_METRICS_DATASET?: string;
	OPS_WEB_AXIOM_QUERY_TIMEOUT_MS?: string;
	OPS_WEB_AXIOM_QUERY_TOKEN?: string;
	OPS_WEB_AXIOM_TRACES_DATASET?: string;
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
	historyQueryId: string | null;
	queryLimit: string | null;
	queryRemaining: string | null;
	queryReset: string | null;
	rowsExamined: number | null;
}

interface ParsedTabularResponse {
	records: Record<string, unknown>[];
	rowsMatched: number | null;
}

export function createAxiomClient(input: {
	edgeUrl: string;
	fetchFn?: typeof fetch;
	logsDataset: string;
	metricsDataset: string;
	onQueryComplete?: (observation: AxiomQueryObservation) => void;
	queryToken: string;
	timeoutMs?: number;
	tracesDataset: string;
}): AxiomClient {
	const queryUrl = normalizeEdgeQueryUrl(input.edgeUrl);
	const datasets = {
		logs: normalizeDatasetName(input.logsDataset),
		metrics: normalizeDatasetName(input.metricsDataset),
		traces: normalizeDatasetName(input.tracesDataset),
	};
	const queryToken = normalizeQueryToken(input.queryToken);
	const timeoutMs = normalizeTimeout(input.timeoutMs);
	const fetchFn = input.fetchFn ?? fetch;
	const onQueryComplete =
		input.onQueryComplete ??
		((observation: AxiomQueryObservation) => {
			console.info("[ops-web] axiom query completed", observation);
		});

	async function runQuery(query: {
		apl: string;
		dataset: string;
		from: Date;
		to: Date;
	}): Promise<ParsedTabularResponse> {
		let response: Response;
		try {
			response = await fetchFn(queryUrl, {
				body: JSON.stringify({
					apl: query.apl,
					endTime: query.to.toISOString(),
					startTime: query.from.toISOString(),
				}),
				headers: {
					accept: "application/json",
					authorization: `Bearer ${queryToken}`,
					"content-type": "application/json",
				},
				method: "POST",
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new AxiomUnavailableError("Axiom query failed.", { cause: error });
		}
		if (!response.ok) {
			throw new AxiomUnavailableError(`Axiom query returned HTTP ${response.status}.`);
		}
		const payload = await parseTabularResponse(response);
		onQueryComplete({
			blocksExamined: payload.status.blocksExamined,
			dataset: query.dataset,
			elapsedTime: payload.status.elapsedTime,
			historyQueryId: normalizeHeader(response.headers.get("x-axiom-history-query-id")),
			queryLimit: normalizeHeader(response.headers.get("x-querylimit-limit")),
			queryRemaining: normalizeHeader(response.headers.get("x-querylimit-remaining")),
			queryReset: normalizeHeader(response.headers.get("x-querylimit-reset")),
			rowsExamined: payload.status.rowsExamined,
		});
		return {
			records: payload.records,
			rowsMatched: payload.status.rowsMatched,
		};
	}

	return {
		async getTelemetrySnapshot(window, requestedNow = new Date()) {
			const from = new Date(requestedNow.valueOf() - overviewWindowMs(window));
			const specs = [
				{ dataset: datasets.logs, kind: "LOGS" as const },
				{ dataset: datasets.metrics, kind: "METRICS" as const },
				{ dataset: datasets.traces, kind: "TRACES" as const },
			];
			const results = await Promise.allSettled(
				specs.map(async (spec) => {
					const payload = await runQuery({
						apl: buildAxiomOverviewApl(spec.dataset),
						dataset: spec.dataset,
						from,
						to: requestedNow,
					});
					const row = payload.records[0] ?? {};
					return {
						lastSeenAt: normalizeTimestamp(row.last_seen_at),
						recordCount: normalizeCount(row.record_count),
					};
				}),
			);
			const signals: OpsOverviewResponse["telemetry"]["signals"] = results.map((result, index) => {
				const kind = specs[index]?.kind ?? "LOGS";
				if (result.status === "rejected") {
					return {
						dataState: "UNAVAILABLE",
						kind,
						reason: "Axiom 数据集查询失败。",
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
				dataState: allUnavailable || anyUnavailable ? "UNAVAILABLE" : "FRESH",
				reason: allUnavailable
					? "Axiom 不可用。"
					: anyUnavailable
						? "部分观测数据集不可用。"
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
			const dataset = queryInput.kind === "logs" ? datasets.logs : datasets.traces;
			const now = queryInput.now ?? new Date();
			const window = requestQueryWindow(queryInput, now);
			const startedAt = Date.now();
			const payload = await runQuery({
				apl: buildAxiomRequestApl({
					dataset,
					kind: queryInput.kind,
					limit: limit + 1,
					requestId: queryInput.requestId,
				}),
				dataset,
				from: window.from,
				to: window.to,
			});
			const records = payload.records.slice(0, limit);
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
		OPS_WEB_AXIOM_EDGE_URL: env.OPS_WEB_AXIOM_EDGE_URL?.trim(),
		OPS_WEB_AXIOM_LOGS_DATASET: env.OPS_WEB_AXIOM_LOGS_DATASET?.trim(),
		OPS_WEB_AXIOM_METRICS_DATASET: env.OPS_WEB_AXIOM_METRICS_DATASET?.trim(),
		OPS_WEB_AXIOM_QUERY_TOKEN: env.OPS_WEB_AXIOM_QUERY_TOKEN?.trim(),
		OPS_WEB_AXIOM_TRACES_DATASET: env.OPS_WEB_AXIOM_TRACES_DATASET?.trim(),
	};
	const missing = Object.entries(required)
		.filter(([, value]) => !value)
		.map(([key]) => key);
	if (missing.length > 0) {
		throw new AxiomUnavailableError(`Axiom configuration is missing: ${missing.join(", ")}.`);
	}
	return createAxiomClient({
		edgeUrl: required.OPS_WEB_AXIOM_EDGE_URL as string,
		logsDataset: required.OPS_WEB_AXIOM_LOGS_DATASET as string,
		metricsDataset: required.OPS_WEB_AXIOM_METRICS_DATASET as string,
		queryToken: required.OPS_WEB_AXIOM_QUERY_TOKEN as string,
		timeoutMs: normalizeEnvInteger(env.OPS_WEB_AXIOM_QUERY_TIMEOUT_MS),
		tracesDataset: required.OPS_WEB_AXIOM_TRACES_DATASET as string,
	});
}

export function buildAxiomOverviewApl(dataset: string) {
	const normalizedDataset = normalizeDatasetName(dataset);
	return [
		`['${normalizedDataset}']`,
		"| summarize record_count = count(), last_seen_at = max(_time)",
		"| project record_count, last_seen_at",
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
	const projection =
		input.kind === "logs"
			? [
					"timestamp = _time",
					"['service.name']",
					"severity_text = tostring(coalesce(severity_text, severityText, severity))",
					"event_type = tostring(coalesce(['event_type'], attributes.custom['event_type'], attributes['event_type'], attributes.custom['event.name'], attributes['event.name'], body['event_type']))",
					"source = tostring(coalesce(['source'], attributes.custom['source'], body['source']))",
					"status = tostring(coalesce(['status'], attributes.custom['status'], body['status']))",
					"error_code = tostring(coalesce(['error_code'], attributes.custom['error_code'], attributes['error_code'], attributes.custom['error.code'], attributes['error.code'], body['error_code']))",
					"duration_ms = todouble(coalesce(['duration_ms'], attributes.custom['duration_ms'], body['duration_ms']))",
					"trace_id = tostring(coalesce(['trace_id'], attributes.custom['trace_id'], attributes['trace_id']))",
					"span_id = tostring(coalesce(['span_id'], attributes.custom['span_id'], attributes['span_id']))",
					"request_id = correlated_request_id",
				]
			: [
					"timestamp = _time",
					"['service.name']",
					"name",
					"kind",
					"duration",
					"['status.code']",
					"trace_id",
					"span_id",
					"parent_span_id",
					"request_id = correlated_request_id",
				];
	return [
		`['${dataset}']`,
		"| extend correlated_request_id = tostring(coalesce(['request_id'], attributes.custom['request_id'], attributes.custom['request.id'], attributes['request_id'], attributes['request.id'], body['request_id'], attributes.custom['http.request.header.x-request-id'], attributes.custom['http.request.header.x_request_id'], attributes['http.request.header.x-request-id'], attributes['http.request.header.x_request_id']))",
		`| where correlated_request_id == ${JSON.stringify(requestId)}`,
		`| project ${projection.join(", ")}`,
		"| sort by timestamp asc",
		`| take ${input.limit}`,
	].join("\n");
}

function requestQueryWindow(input: AxiomQueryInput, now: Date) {
	const startedAt = Date.parse(input.startedAt);
	const completedAt = input.completedAt ? Date.parse(input.completedAt) : now.valueOf();
	if (
		!(Number.isFinite(startedAt) && Number.isFinite(completedAt) && Number.isFinite(now.valueOf()))
	) {
		throw new AxiomUnavailableError("Axiom query received invalid request timestamps.");
	}
	const unboundedFrom = startedAt - QUERY_PADDING_MS;
	const to = Math.min(now.valueOf(), completedAt + QUERY_PADDING_MS);
	if (to < unboundedFrom) {
		throw new AxiomUnavailableError("Axiom query received an invalid request time range.");
	}
	const from = Math.max(unboundedFrom, to - MAX_REQUEST_QUERY_WINDOW_MS);
	return {
		clamped: from > unboundedFrom,
		from: new Date(from),
		to: new Date(to),
	};
}

function normalizeEdgeQueryUrl(value: string) {
	const parsed = new URL(value);
	if (parsed.protocol !== "https:") {
		throw new Error("Axiom Edge URL must use HTTPS.");
	}
	if (parsed.username || parsed.password || parsed.hash) {
		throw new Error("Axiom Edge URL must not contain credentials or a fragment.");
	}
	const path = parsed.pathname.replace(/\/+$/, "");
	const isBaseUrl = !path || path === "/v1";
	const isExactQueryUrl = path === "/v1/query/_apl";
	const queryEntries = [...parsed.searchParams.entries()];
	const hasExactFormat =
		queryEntries.length === 1 &&
		queryEntries[0]?.[0] === "format" &&
		queryEntries[0]?.[1] === "tabular";
	if (!((isBaseUrl && queryEntries.length === 0) || (isExactQueryUrl && hasExactFormat))) {
		throw new Error(
			"Axiom Edge URL must be a base domain, end with /v1, or be the tabular Edge APL endpoint.",
		);
	}
	return `${parsed.origin}/v1/query/_apl?format=tabular`;
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

function normalizeTimeout(value: number | undefined) {
	if (value === undefined) {
		return DEFAULT_TIMEOUT_MS;
	}
	if (!(Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS)) {
		throw new Error(`Axiom query timeout must be between 1 and ${MAX_TIMEOUT_MS} milliseconds.`);
	}
	return value;
}

function normalizeEnvInteger(value: string | undefined): number | undefined {
	if (!value?.trim()) {
		return;
	}
	const parsed = Number(value);
	if (!(Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TIMEOUT_MS)) {
		throw new AxiomUnavailableError(
			`OPS_WEB_AXIOM_QUERY_TIMEOUT_MS must be between 1 and ${MAX_TIMEOUT_MS}.`,
		);
	}
	return parsed;
}

async function parseTabularResponse(response: Response): Promise<{
	records: Record<string, unknown>[];
	status: {
		blocksExamined: number | null;
		elapsedTime: number | null;
		rowsExamined: number | null;
		rowsMatched: number | null;
	};
}> {
	let value: unknown;
	try {
		value = await response.json();
	} catch (error) {
		throw new AxiomUnavailableError("Axiom returned invalid JSON.", { cause: error });
	}
	if (!isRecord(value) || value.format !== "tabular" || !isRecord(value.status)) {
		throw new AxiomUnavailableError("Axiom returned an invalid tabular response.");
	}
	if (value.status.isPartial !== false) {
		throw new AxiomUnavailableError("Axiom returned a partial query result.");
	}
	if (!Array.isArray(value.tables)) {
		throw new AxiomUnavailableError("Axiom tabular response is missing tables.");
	}
	const records = value.tables.flatMap(parseTableRows);
	return {
		records,
		status: {
			blocksExamined: optionalNonNegativeNumber(value.status.blocksExamined),
			elapsedTime: optionalNonNegativeNumber(value.status.elapsedTime),
			rowsExamined: optionalNonNegativeNumber(value.status.rowsExamined),
			rowsMatched: optionalNonNegativeNumber(value.status.rowsMatched),
		},
	};
}

function parseTableRows(value: unknown): Record<string, unknown>[] {
	if (!(isRecord(value) && Array.isArray(value.fields))) {
		throw new AxiomUnavailableError("Axiom returned an invalid tabular table.");
	}
	const fieldNames = value.fields.map((field) => {
		if (!isRecord(field) || typeof field.name !== "string" || !field.name) {
			throw new AxiomUnavailableError("Axiom returned an invalid tabular field.");
		}
		return field.name;
	});
	if (new Set(fieldNames).size !== fieldNames.length) {
		throw new AxiomUnavailableError("Axiom returned duplicate tabular fields.");
	}
	if (value.columns === undefined) {
		return [];
	}
	if (!Array.isArray(value.columns) || value.columns.length !== fieldNames.length) {
		throw new AxiomUnavailableError("Axiom returned invalid tabular columns.");
	}
	const columns = value.columns.map((column) => {
		if (!Array.isArray(column)) {
			throw new AxiomUnavailableError("Axiom returned an invalid tabular column.");
		}
		return column;
	});
	const rowCount = columns[0]?.length ?? 0;
	if (columns.some((column) => column.length !== rowCount)) {
		throw new AxiomUnavailableError("Axiom returned misaligned tabular columns.");
	}
	return Array.from({ length: rowCount }, (_, rowIndex) =>
		Object.fromEntries(
			fieldNames.map((fieldName, fieldIndex) => [fieldName, columns[fieldIndex]?.[rowIndex]]),
		),
	);
}

function normalizeHeader(value: string | null) {
	const normalized = value?.trim();
	return normalized ? normalized.slice(0, 256) : null;
}

function optionalNonNegativeNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
