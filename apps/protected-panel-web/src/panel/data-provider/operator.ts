import type { Identifier } from "react-admin";

import { fetchJson } from "../http";
import {
	normalizeOperatorAuditEventDetailRecord,
	normalizeOperatorAuditEventRecord,
	normalizeOperatorCostSummaryRecord,
	normalizeOperatorCostTimeseriesRecord,
	normalizeOperatorOverviewRecord,
	normalizeOperatorQualityBadcaseRecord,
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
	type OperatorOverviewRecord,
	type OperatorQualityBadcaseListFilterInput,
	type OperatorQualityBadcaseRecord,
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
	type RawOperatorOverviewRecord,
	type RawOperatorQualityBadcaseListResponse,
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

export async function listOperatorQualityBadcases(
	input?: OperatorQualityBadcaseListFilterInput & { signal?: AbortSignal },
): Promise<SequentialCursorListResult<OperatorQualityBadcaseRecord>> {
	return getSequentialCursorList<
		RawOperatorQualityBadcaseListResponse,
		RawOperatorQualityBadcaseListResponse["badcases"][number],
		OperatorQualityBadcaseRecord
	>({
		buildQuery(query) {
			appendOptionalQueryParam(query, "status", input?.status);
			appendOptionalQueryParam(query, "causeClass", input?.causeClass);
			appendOptionalQueryParam(query, "detectedBy", input?.detectedBy);
		},
		cursorFilter: {
			causeClass: input?.causeClass,
			detectedBy: input?.detectedBy,
			status: input?.status,
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
			appendOptionalQueryParam(query, "severity", input?.severity);
			appendOptionalQueryParam(query, "status", input?.status);
			appendOptionalQueryParam(query, "anomalyCode", input?.anomalyCode);
		},
		cursorFilter: {
			anomalyCode: input?.anomalyCode,
			severity: input?.severity,
			status: input?.status,
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
		`/api/operator/audit/${input.auditEventId}`,
		{
			signal: input.signal,
		},
	);

	return {
		data: normalizeOperatorAuditEventDetailRecord(payload),
	};
}
