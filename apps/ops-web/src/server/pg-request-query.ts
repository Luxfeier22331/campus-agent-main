import { normalizeDbStatusToSummaryKey, normalizeStatusToDbValues } from "./ops-status-mappers.ts";
import type { OpsRequestListQuery, OpsRequestSummaryTotals } from "./ops-status-store.ts";

export function requestProjectionSql(suffix: string): string {
	return `
		select
			"completed_at" as "completedAt",
			"conversation_id" as "conversationId",
			"duration_ms" as "durationMs",
			"error_code" as "errorCode",
			"principal_id" as "principalId",
			"principal_type" as "principalType",
			"projected_at" as "projectedAt",
			"question_preview" as "questionPreview",
			"request_id" as "requestId",
			"requested_tool" as "requestedTool",
			"selected_tool" as "selectedTool",
			"started_at" as "startedAt",
			"status",
			"trace_id" as "traceId"
		from "operator"."request_projection"
		${suffix}
	`;
}

export function requestObservabilitySql(suffix: string): string {
	return `
			select
				"acl_anomaly_code" as "aclAnomalyCode",
				"acl_decision" as "aclDecision",
				"debug_trace_refs_json" as "debugTraceRefsJson",
				"fail_closed" as "failClosed",
				"measured_at" as "measuredAt",
				"model_name" as "modelName",
				"model_provider" as "modelProvider",
				"prompt_id" as "promptId",
				"prompt_version" as "promptVersion",
				"projection_lag_ms" as "projectionLagMs",
				"refusal_class" as "refusalClass",
				"request_id" as "requestId",
				"scope_class" as "scopeClass",
				"semantic_outcome" as "semanticOutcome",
				"stage_timing_json" as "stageTimingJson",
				"supporting_sources_json" as "supportingSourcesJson",
				"template_sha256" as "templateSha256",
				"trace_available" as "traceAvailable",
				"updated_at" as "updatedAt",
				"workflow_trace_summary_json" as "workflowTraceSummaryJson"
		from "runtime"."request_observability_fact"
		${suffix}
	`;
}

export function buildRequestProjectionFilter(
	query: OpsRequestListQuery,
	since: Date,
): {
	values: unknown[];
	whereClause: string;
} {
	const values: unknown[] = [];
	const conditions: string[] = [];
	values.push(since);
	conditions.push(`"started_at" >= $${values.length}`);
	addStatusFilter(conditions, values, query.status);
	addEquals(conditions, values, "conversation_id", query.conversationId);
	addEquals(conditions, values, "request_id", query.requestId);
	addEquals(conditions, values, "trace_id", query.traceId);
	if (query.q) {
		values.push(`%${escapeLikePattern(query.q)}%`);
		conditions.push(
			`("request_id" ilike $${values.length} or "trace_id" ilike $${values.length} or "conversation_id" ilike $${values.length} or "question_preview" ilike $${values.length} or "requested_tool" ilike $${values.length} or "selected_tool" ilike $${values.length} or "error_code" ilike $${values.length})`,
		);
	}
	return {
		values,
		whereClause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
	};
}

export function summarizeStatusCounts(
	rows: Array<{ count: number | string; status: string }>,
): OpsRequestSummaryTotals {
	const summary: OpsRequestSummaryTotals = {
		cancelled: 0,
		completed: 0,
		failed: 0,
		pending: 0,
		running: 0,
		total: 0,
	};
	for (const row of rows) {
		const count = typeof row.count === "number" ? row.count : Number.parseInt(row.count, 10);
		if (!(Number.isFinite(count) && count > 0)) {
			continue;
		}
		summary[normalizeDbStatusToSummaryKey(row.status)] += count;
		summary.total += count;
	}
	return summary;
}

function escapeLikePattern(value: string): string {
	return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function addEquals(
	conditions: string[],
	values: unknown[],
	columnName: string,
	value: string | undefined,
): void {
	if (!value) {
		return;
	}
	values.push(value);
	conditions.push(`"${columnName}" = $${values.length}`);
}

function addStatusFilter(
	conditions: string[],
	values: unknown[],
	status: OpsRequestListQuery["status"] | undefined,
): void {
	const statuses = normalizeStatusToDbValues(status);
	if (statuses.length === 0) {
		return;
	}
	values.push(statuses);
	conditions.push(`"status" = any($${values.length})`);
}
