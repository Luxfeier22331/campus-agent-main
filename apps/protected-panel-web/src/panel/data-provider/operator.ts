import type { Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeOperatorAuditEventDetailRecord,
	normalizeOperatorAuditEventRecord,
	normalizeOperatorCostSummaryRecord,
	normalizeOperatorCostTimeseriesRecord,
	normalizeOperatorEvalCoverageRecord,
	normalizeOperatorIntentSummaryRecord,
	normalizeOperatorIntentTimeseriesRecord,
	normalizeOperatorOverviewRecord,
	normalizeOperatorQualityBadcaseRecord,
	normalizeOperatorQualityEvalCandidateRecord,
	normalizeOperatorQualitySummaryRecord,
	normalizeOperatorQualityTimeseriesRecord,
	normalizeOperatorSafetyAnomalyRecord,
	normalizeOperatorSafetySummaryRecord,
	type OperatorAggregateFilterInput,
	type OperatorAuditEventDetailResponse,
	type OperatorAuditEventRecord,
	type OperatorAuditListFilterInput,
	type OperatorCostSummaryRecord,
	type OperatorCostTimeseriesRecord,
	type OperatorEvalCoverageRecord,
	type OperatorIntentSummaryRecord,
	type OperatorIntentTimeseriesRecord,
	type OperatorOverviewRecord,
	type OperatorQualityBadcaseListFilterInput,
	type OperatorQualityBadcaseRecord,
	type OperatorQualityEvalCandidateRecord,
	type OperatorQualitySummaryRecord,
	type OperatorQualityTimeseriesRecord,
	type OperatorSafetyAnomalyListFilterInput,
	type OperatorSafetyAnomalyRecord,
	type OperatorSafetySummaryRecord,
	type OperatorTimeseriesFilterInput,
	type RawOperatorAuditEventDetailResponse,
	type RawOperatorAuditListResponse,
	type RawOperatorCostSummaryRecord,
	type RawOperatorCostTimeseriesRecord,
	type RawOperatorEvalCoverageRecord,
	type RawOperatorIntentSummaryRecord,
	type RawOperatorIntentTimeseriesRecord,
	type RawOperatorOverviewRecord,
	type RawOperatorQualityBadcaseListResponse,
	type RawOperatorQualityEvalCandidateListResponse,
	type RawOperatorQualitySummaryRecord,
	type RawOperatorQualityTimeseriesRecord,
	type RawOperatorSafetyAnomalyListResponse,
	type RawOperatorSafetySummaryRecord,
} from "../types";
import { getSequentialCursorList, type SequentialCursorListResult } from "./cursor";
import {
	appendOperatorAggregateFilters,
	appendOperatorTimeseriesFilters,
	appendOptionalQueryParam,
} from "./filters";
import { encodePathIdentifier } from "./path";

export async function getOperatorOverview(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorOverviewRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorOverviewRecord>(
		`/api/operator/overview?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorOverviewRecord(payload),
	};
}

export async function getOperatorQualitySummary(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorQualitySummaryRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorQualitySummaryRecord>(
		`/api/operator/quality/summary?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorQualitySummaryRecord(payload),
	};
}

export async function getOperatorQualityTimeseries(
	input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorQualityTimeseriesRecord }> {
	const query = new URLSearchParams();
	appendOperatorTimeseriesFilters(query, input);

	const payload = await fetchJson<RawOperatorQualityTimeseriesRecord>(
		`/api/operator/quality/timeseries?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorQualityTimeseriesRecord(payload),
	};
}

export async function getOperatorIntentSummary(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorIntentSummaryRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorIntentSummaryRecord>(
		`/api/operator/intent/summary?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorIntentSummaryRecord(payload),
	};
}

export async function getOperatorIntentTimeseries(
	input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorIntentTimeseriesRecord }> {
	const query = new URLSearchParams();
	appendOperatorTimeseriesFilters(query, input);

	const payload = await fetchJson<RawOperatorIntentTimeseriesRecord>(
		`/api/operator/intent/timeseries?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorIntentTimeseriesRecord(payload),
	};
}

export async function listOperatorQualityBadcases(
	input?: OperatorQualityBadcaseListFilterInput & { signal?: AbortSignal },
): Promise<SequentialCursorListResult<OperatorQualityBadcaseRecord>> {
	return getSequentialCursorList<
		RawOperatorQualityBadcaseListResponse,
		RawOperatorQualityBadcaseListResponse["badcases"][number],
		OperatorQualityBadcaseRecord
	>({
		buildQuery(query) {
			appendOptionalQueryParam(query, "window", input?.window);
			appendOptionalQueryParam(query, "surface", input?.surface);
			appendOptionalQueryParam(query, "selectedTarget", input?.selectedTarget);
			appendOptionalQueryParam(query, "status", input?.status);
			appendOptionalQueryParam(query, "causeClass", input?.causeClass);
			appendOptionalQueryParam(query, "detectedBy", input?.detectedBy);
		},
		cursorFilter: {
			causeClass: input?.causeClass,
			detectedBy: input?.detectedBy,
			selectedTarget: input?.selectedTarget,
			status: input?.status,
			surface: input?.surface,
			window: input?.window,
		},
		normalizeRecord: normalizeOperatorQualityBadcaseRecord,
		page: input?.page,
		perPage: input?.perPage,
		resource: "operatorQualityBadcases",
		resourceLabel: "operator quality badcase",
		responseItems(payload) {
			return payload.badcases;
		},
		signal: input?.signal,
		sourcePath: "/api/operator/quality/badcases",
	});
}

export async function listOperatorQualityEvalCandidates(
	input?: OperatorQualityBadcaseListFilterInput & { signal?: AbortSignal },
): Promise<SequentialCursorListResult<OperatorQualityEvalCandidateRecord>> {
	return getSequentialCursorList<
		RawOperatorQualityEvalCandidateListResponse,
		RawOperatorQualityEvalCandidateListResponse["candidates"][number],
		OperatorQualityEvalCandidateRecord
	>({
		buildQuery(query) {
			appendOptionalQueryParam(query, "window", input?.window);
			appendOptionalQueryParam(query, "surface", input?.surface);
			appendOptionalQueryParam(query, "selectedTarget", input?.selectedTarget);
			appendOptionalQueryParam(query, "status", input?.status);
			appendOptionalQueryParam(query, "causeClass", input?.causeClass);
			appendOptionalQueryParam(query, "detectedBy", input?.detectedBy);
		},
		cursorFilter: {
			causeClass: input?.causeClass,
			detectedBy: input?.detectedBy,
			selectedTarget: input?.selectedTarget,
			status: input?.status,
			surface: input?.surface,
			window: input?.window,
		},
		normalizeRecord: normalizeOperatorQualityEvalCandidateRecord,
		page: input?.page,
		perPage: input?.perPage,
		resource: "operatorQualityEvalCandidates",
		resourceLabel: "operator quality eval candidate",
		responseItems(payload) {
			return payload.candidates;
		},
		signal: input?.signal,
		sourcePath: "/api/operator/quality/eval-candidates",
	});
}

export async function getOperatorSafetySummary(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorSafetySummaryRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorSafetySummaryRecord>(
		`/api/operator/safety/summary?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorSafetySummaryRecord(payload),
	};
}

export async function listOperatorSafetyAnomalies(
	input?: OperatorSafetyAnomalyListFilterInput & { signal?: AbortSignal },
): Promise<SequentialCursorListResult<OperatorSafetyAnomalyRecord>> {
	return getSequentialCursorList<
		RawOperatorSafetyAnomalyListResponse,
		RawOperatorSafetyAnomalyListResponse["anomalies"][number],
		OperatorSafetyAnomalyRecord
	>({
		buildQuery(query) {
			appendOptionalQueryParam(query, "window", input?.window);
			appendOptionalQueryParam(query, "surface", input?.surface);
			appendOptionalQueryParam(query, "selectedTarget", input?.selectedTarget);
			appendOptionalQueryParam(query, "severity", input?.severity);
			appendOptionalQueryParam(query, "status", input?.status);
			appendOptionalQueryParam(query, "anomalyCode", input?.anomalyCode);
		},
		cursorFilter: {
			anomalyCode: input?.anomalyCode,
			selectedTarget: input?.selectedTarget,
			severity: input?.severity,
			status: input?.status,
			surface: input?.surface,
			window: input?.window,
		},
		normalizeRecord: normalizeOperatorSafetyAnomalyRecord,
		page: input?.page,
		perPage: input?.perPage,
		resource: "operatorSafetyAnomalies",
		resourceLabel: "operator safety anomaly",
		responseItems(payload) {
			return payload.anomalies;
		},
		signal: input?.signal,
		sourcePath: "/api/operator/safety/anomalies",
	});
}

export async function getOperatorCostSummary(
	input?: OperatorAggregateFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorCostSummaryRecord }> {
	const query = new URLSearchParams();
	appendOperatorAggregateFilters(query, input);

	const payload = await fetchJson<RawOperatorCostSummaryRecord>(
		`/api/operator/cost/summary?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorCostSummaryRecord(payload),
	};
}

export async function getOperatorCostTimeseries(
	input?: OperatorTimeseriesFilterInput & { signal?: AbortSignal },
): Promise<{ data: OperatorCostTimeseriesRecord }> {
	const query = new URLSearchParams();
	appendOperatorTimeseriesFilters(query, input);

	const payload = await fetchJson<RawOperatorCostTimeseriesRecord>(
		`/api/operator/cost/timeseries?${query.toString()}`,
		{
			signal: input?.signal,
		},
	);

	return {
		data: normalizeOperatorCostTimeseriesRecord(payload),
	};
}

export async function getOperatorEvalCoverage(input?: {
	signal?: AbortSignal;
}): Promise<{ data: OperatorEvalCoverageRecord }> {
	const payload = await fetchJson<RawOperatorEvalCoverageRecord>("/api/operator/evals/coverage", {
		signal: input?.signal,
	});

	return {
		data: normalizeOperatorEvalCoverageRecord(payload),
	};
}

export async function listOperatorAudit(
	input?: OperatorAuditListFilterInput & { signal?: AbortSignal },
): Promise<SequentialCursorListResult<OperatorAuditEventRecord>> {
	return getSequentialCursorList<
		RawOperatorAuditListResponse,
		RawOperatorAuditListResponse["events"][number],
		OperatorAuditEventRecord
	>({
		buildQuery(query) {
			appendOptionalQueryParam(query, "requestId", input?.requestId);
			appendOptionalQueryParam(query, "traceId", input?.traceId);
			appendOptionalQueryParam(query, "principalType", input?.principalType);
			appendOptionalQueryParam(query, "surface", input?.surface);
			appendOptionalQueryParam(query, "selectedTarget", input?.selectedTarget);
			appendOptionalQueryParam(query, "eventType", input?.eventType);
			appendOptionalQueryParam(query, "status", input?.status);
		},
		cursorFilter: {
			eventType: input?.eventType,
			principalType: input?.principalType,
			requestId: input?.requestId,
			selectedTarget: input?.selectedTarget,
			status: input?.status,
			surface: input?.surface,
			traceId: input?.traceId,
		},
		normalizeRecord: normalizeOperatorAuditEventRecord,
		page: input?.page,
		perPage: input?.perPage,
		resource: "operatorAudit",
		resourceLabel: "operator audit",
		responseItems(payload) {
			return payload.events;
		},
		signal: input?.signal,
		sourcePath: "/api/operator/audit",
	});
}

export async function getOperatorAuditEvent(input: {
	auditEventId: Identifier;
	signal?: AbortSignal;
}): Promise<{ data: OperatorAuditEventDetailResponse }> {
	const payload = await fetchJson<RawOperatorAuditEventDetailResponse>(
		`/api/operator/audit/${encodePathIdentifier(input.auditEventId)}`,
		{
			signal: input.signal,
		},
	);

	return {
		data: normalizeOperatorAuditEventDetailRecord(payload),
	};
}
