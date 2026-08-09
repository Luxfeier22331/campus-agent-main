import { AxiomWithoutBatching, type TabularQueryResult } from "@axiomhq/js";

import {
	type OpsObservabilityResponse,
	OpsObservabilityResponseSchema,
} from "../shared/ops-contract.ts";
import { raceWithSignal } from "./race-with-signal.ts";
import { resolveRequestObservabilityWindow } from "./request-observability-window.ts";

const DATASET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EDGE_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const MAX_ACTIVE_AXIOM_QUERIES = 5;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type OpsObservabilityKind = "logs";

export interface AxiomQueryInput {
	completedAt: string | null;
	kind: OpsObservabilityKind;
	now?: Date;
	requestId: string;
	signal?: AbortSignal;
	startedAt: string;
}

export interface AxiomClient {
	queryRequest(input: AxiomQueryInput): Promise<OpsObservabilityResponse>;
}

export interface AxiomEnv {
	AXIOM_QUERY_TOKEN?: string;
	OPS_WEB_AXIOM_EDGE_DOMAIN?: string;
	OPS_WEB_AXIOM_LOGS_DATASET?: string;
}

export interface AxiomSdkQueryClient {
	query(
		apl: string,
		options: { endTime: string; format: "tabular"; startTime: string },
	): Promise<TabularQueryResult>;
}

export class AxiomUnavailableError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AxiomUnavailableError";
	}
}

interface ParsedTabularResponse {
	records: Record<string, unknown>[];
	rowsMatched: number | null;
}

export function createAxiomClient(input: {
	edgeDomain: string;
	logsDataset: string;
	queryToken: string;
	sdkClient?: AxiomSdkQueryClient;
}): AxiomClient {
	const edgeDomain = normalizeEdgeDomain(input.edgeDomain);
	const logsDataset = normalizeDatasetName(input.logsDataset);
	const queryToken = normalizeQueryToken(input.queryToken);
	const sdkClient: AxiomSdkQueryClient =
		input.sdkClient ??
		new AxiomWithoutBatching({
			axiomClient: "campus-agent-ops-web",
			edge: edgeDomain,
			token: queryToken,
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
		return {
			records,
			rowsMatched: optionalNonNegativeNumber(result.status.rowsMatched),
		};
	}

	return {
		async queryRequest(queryInput) {
			const limit = 200;
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
					dataset: logsDataset,
					limit: limit + 1,
					requestId: queryInput.requestId,
				}),
				from: window.from,
				signal: queryInput.signal,
				to: window.to,
			});
			const records = payload.records.slice(0, limit).map(mapAxiomLogRecord);
			return OpsObservabilityResponseSchema.parse({
				dataState: records.length === 0 ? "NO_DATA" : "FRESH",
				from: window.from.toISOString(),
				kind: "logs",
				limit,
				queriedAt: now.toISOString(),
				queryDurationMs: Math.max(0, Date.now() - startedAt),
				records,
				requestId: queryInput.requestId,
				source: "AXIOM",
				to: window.to.toISOString(),
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
		queryToken: required.AXIOM_QUERY_TOKEN as string,
	});
}

export function buildAxiomRequestApl(input: { dataset: string; limit: number; requestId: string }) {
	const dataset = normalizeDatasetName(input.dataset);
	const requestId = normalizeRequestId(input.requestId);
	if (!(Number.isInteger(input.limit) && input.limit > 0 && input.limit <= 501)) {
		throw new Error("Axiom query limit is invalid.");
	}
	const quotedRequestId = JSON.stringify(requestId);
	const requestAttribute = "tostring(['attributes.custom']['campus.request_id'])";
	const requestBody = "tostring(body['campus.request_id'])";
	return [
		`['${dataset}']`,
		`| where ${requestAttribute} == ${quotedRequestId} or ${requestBody} == ${quotedRequestId}`,
		"| project timestamp = _time, serviceName = ['service.name'], severityText = tostring(coalesce(severity_text, severityText, severity)), eventType = tostring(coalesce(['attributes.custom']['event_type'], body['event_type'])), source = tostring(coalesce(['attributes.custom']['source'], body['source'])), status = tostring(coalesce(['attributes.custom']['status'], body['status'])), errorCode = tostring(coalesce(['attributes.custom']['error.code'], body['error_code'])), durationMs = todouble(coalesce(['attributes.custom']['duration_ms'], body['duration_ms'])), requestId = tostring(coalesce(['attributes.custom']['campus.request_id'], body['campus.request_id']))",
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

function mapAxiomLogRecord(record: Record<string, unknown>) {
	return {
		durationMs: nullableNonNegativeNumber(record.durationMs),
		errorCode: nullableString(record.errorCode),
		eventType: nullableString(record.eventType),
		requestId: requiredString(record.requestId, "requestId"),
		serviceName: nullableString(record.serviceName),
		severityText: nullableString(record.severityText),
		source: nullableString(record.source),
		status: nullableString(record.status),
		timestamp: requiredTimestamp(record.timestamp),
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

function optionalNonNegativeNumber(value: unknown) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
