import {
	normalizeDbStatusToSummaryKey,
	normalizeStatusToDbValues,
	requestListView,
} from "./ops-status-mappers.ts";
import type { OpsRequestListQuery, OpsRequestSummaryTotals } from "./ops-status-types.ts";

export function requestSql(suffix: string): string {
	return `
			${requestRowsCte()}
			select
				"assistant_kind" as "assistantKind",
				"assistant_message_present" as "assistantMessagePresent",
				"attention_reason" as "attentionReason",
				"completed_at" as "completedAt",
			"conversation_id" as "conversationId",
			"duration_ms" as "durationMs",
			"error_code" as "errorCode",
				"projected_at" as "dataUpdatedAt",
				"question_preview" as "questionPreview",
				"question_truncated" as "questionTruncated",
			"request_id" as "requestId",
			"run_id" as "runId",
			"run_status" as "runStatus",
			"runtime_versions_json" as "runtimeVersionsJson",
			"attention_priority" as "attentionPriority",
			"started_at" as "startedAt",
			"status",
			"surface",
			"terminal_reason" as "terminalReason",
				"trace_id" as "traceId",
				"turn_sequence" as "turnSequence",
				"workflow_id" as "workflowId"
		from request_rows
		${suffix}
	`;
}

export function requestDetailSql(suffix: string): string {
	return `
			${requestRowsCte()}
			select
				"assistant_kind" as "assistantKind",
				"assistant_message_present" as "assistantMessagePresent",
				"assistant_message_text" as "assistantMessageText",
				"assistant_structured_parts_json" as "assistantStructuredPartsJson",
				"attention_reason" as "attentionReason",
				"completed_at" as "completedAt",
				"conversation_id" as "conversationId",
				"duration_ms" as "durationMs",
				"error_code" as "errorCode",
				"projected_at" as "dataUpdatedAt",
				"question_preview" as "questionPreview",
				"question_text" as "questionText",
				"question_truncated" as "questionTruncated",
				"request_id" as "requestId",
				"run_id" as "runId",
				"run_status" as "runStatus",
				"runtime_versions_json" as "runtimeVersionsJson",
				"attention_priority" as "attentionPriority",
				"started_at" as "startedAt",
				"status",
				"surface",
				"terminal_reason" as "terminalReason",
				"trace_id" as "traceId",
				"turn_sequence" as "turnSequence",
				"workflow_id" as "workflowId"
			from request_rows
			${suffix}
	`;
}

export function requestRowsCte(): string {
	return `
		with request_rows as (
			select
				dispatch.completed_at as "completed_at",
				dispatch.conversation_id as "conversation_id",
				case
					when dispatch.completed_at is null then null
					else round(extract(epoch from (dispatch.completed_at - dispatch.created_at)) * 1000)::int
				end as "duration_ms",
				coalesce(
					dispatch.error_code,
					nullif(agent_run.fail_close_reason, ''),
					case
						when agent_run.status in ('failed', 'expired')
							then nullif(agent_run.terminal_reason, '')
					end
				) as "error_code",
					greatest(
					dispatch.updated_at,
					coalesce(agent_run.updated_at, dispatch.updated_at)
				) as "projected_at",
					assistant_message.kind as "assistant_kind",
					assistant_message.id is not null as "assistant_message_present",
					assistant_message.text as "assistant_message_text",
					assistant_message.structured_parts_json as "assistant_structured_parts_json",
					left(user_message.text, 280) as "question_preview",
					user_message.text as "question_text",
					char_length(user_message.text) > 280 as "question_truncated",
				dispatch.request_id as "request_id",
				coalesce(nullif(agent_run.run_id, ''), dispatch.run_id) as "run_id",
				nullif(agent_run.status, '') as "run_status",
				coalesce(agent_run.runtime_versions_json, '{}'::jsonb) as "runtime_versions_json",
				dispatch.created_at as "started_at",
				case
					when dispatch.status <> 'accepted' then dispatch.status
					when agent_run.status in ('running', 'streaming') then 'running'
						when agent_run.status in ('completed', 'failed', 'expired', 'canceled') then 'running'
						else dispatch.status
					end as "status",
					case
						when dispatch.status in (
							'completed', 'error', 'rejected', 'approval_required', 'cancelled'
						) and assistant_message.id is null then 0
						when dispatch.status in ('error', 'rejected') then 1
						when dispatch.status = 'approval_required' then 2
						else null
					end as "attention_priority",
					case
						when dispatch.status in (
							'completed', 'error', 'rejected', 'approval_required', 'cancelled'
						) and assistant_message.id is null then 'RESULT_MISSING'
						when dispatch.status in ('error', 'rejected') then 'REQUEST_FAILED'
						when dispatch.status = 'approval_required' then 'WAITING_USER'
						else null
					end as "attention_reason",
				dispatch.surface as "surface",
					nullif(agent_run.terminal_reason, '') as "terminal_reason",
					coalesce(nullif(agent_run.trace_id, ''), dispatch.trace_id) as "trace_id",
					dispatch.turn_sequence as "turn_sequence",
					case
						when coalesce(nullif(agent_run.run_id, ''), dispatch.run_id) is null then null
						else 'campus-agent.chat.' || coalesce(nullif(agent_run.run_id, ''), dispatch.run_id)
					end as "workflow_id"
			from "chat"."turn_dispatches" as dispatch
			join "chat"."messages" as user_message
				on user_message.id = dispatch.user_message_id
				left join "execution_control"."agent_runs" as agent_run
					on agent_run.run_id = dispatch.run_id
				left join "chat"."messages" as assistant_message
					on assistant_message.id = dispatch.assistant_message_id
					and assistant_message.request_id = dispatch.request_id
					and assistant_message.conversation_id = dispatch.conversation_id
					and assistant_message.role = 'assistant'
			)
		`;
}

export function buildRequestFilter(
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
	if (requestListView(query) === "attention") {
		conditions.push('"attention_priority" is not null');
	}
	addStatusFilter(conditions, values, query.status);
	addEquals(conditions, values, "conversation_id", query.conversationId);
	addEquals(conditions, values, "request_id", query.requestId);
	addEquals(conditions, values, "run_id", query.runId);
	addEquals(conditions, values, "trace_id", query.traceId);
	addEquals(conditions, values, "workflow_id", query.workflowId);
	if (query.q) {
		values.push(`%${escapeLikePattern(query.q)}%`);
		conditions.push(
			`("request_id" ilike $${values.length} or "trace_id" ilike $${values.length} or "conversation_id" ilike $${values.length} or "run_id" ilike $${values.length} or "workflow_id" ilike $${values.length} or "question_preview" ilike $${values.length} or "error_code" ilike $${values.length})`,
		);
	}
	return {
		values,
		whereClause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
	};
}

export function agentUsageSql(suffix: string): string {
	return `
			select
				"run_id" as "runId",
				count(*)::int as "totalAttemptCount",
				count(*) filter (where "usage_observed")::int as "observedAttemptCount",
				sum("input_tokens") filter (where "usage_observed") as "inputTokens",
				sum("cached_input_tokens") filter (where "usage_observed") as "cachedInputTokens",
				sum("output_tokens") filter (where "usage_observed") as "outputTokens"
			from "execution_control"."agent_step_attempts"
			where "step_id" = 'agent.primary' ${suffix}
			group by "run_id"
		`;
}

export function summarizeStatusCounts(
	rows: Array<{ count: number | string; status: string }>,
): OpsRequestSummaryTotals {
	const summary: OpsRequestSummaryTotals = {
		actionRequired: 0,
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
