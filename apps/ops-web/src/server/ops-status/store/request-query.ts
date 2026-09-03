import type { OpsRequestListQuery } from "../contract.ts";
import { requestListView } from "../mapping/request.ts";
import { normalizeDbStatusToSummaryKey, normalizeStatusToDbValues } from "../mapping/values.ts";
import type { OpsRequestSummaryTotals } from "./types.ts";

export function requestSql(suffix: string): string {
	return `
			${requestRowsCte()}
			select
				"assistant_kind" as "assistantKind",
				"assistant_message_present" as "assistantMessagePresent",
				"attention_reason" as "attentionReason",
				"completed_at" as "completedAt",
			"duration_ms" as "durationMs",
			"error_code" as "errorCode",
			"execution_failure_kind" as "executionFailureKind",
			"execution_step_kind" as "executionStepKind",
			"execution_step_status" as "executionStepStatus",
			"fail_close_reason" as "failCloseReason",
				"projected_at" as "dataUpdatedAt",
				"question_preview" as "questionPreview",
				"question_truncated" as "questionTruncated",
			"request_id" as "requestId",
			"run_status" as "runStatus",
			"attention_priority" as "attentionPriority",
			"started_at" as "startedAt",
			"status",
			"terminal_reason" as "terminalReason"
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
				"duration_ms" as "durationMs",
				"error_code" as "errorCode",
				"execution_failure_kind" as "executionFailureKind",
				"execution_step_kind" as "executionStepKind",
				"execution_step_status" as "executionStepStatus",
				"fail_close_reason" as "failCloseReason",
				"projected_at" as "dataUpdatedAt",
				"question_preview" as "questionPreview",
				"question_text" as "questionText",
				"question_truncated" as "questionTruncated",
				"request_id" as "requestId",
				"run_status" as "runStatus",
				"attention_priority" as "attentionPriority",
				"started_at" as "startedAt",
				"status",
				"terminal_reason" as "terminalReason"
			from request_rows
			${suffix}
	`;
}

export function requestRowsCte(): string {
	return `
		with request_rows as (
			select
				dispatch.completed_at as "completed_at",
				case
					when dispatch.completed_at is null then null
					else round(extract(epoch from (dispatch.completed_at - dispatch.created_at)) * 1000)::int
				end as "duration_ms",
				nullif(dispatch.error_code, '') as "error_code",
				nullif(
					latest_failure_step.sanitized_payload_json -> 'failure' ->> 'code',
					''
				) as "execution_failure_kind",
				latest_step.step_kind as "execution_step_kind",
				latest_step.status as "execution_step_status",
				nullif(agent_run.fail_close_reason, '') as "fail_close_reason",
					greatest(
					dispatch.updated_at,
					coalesce(agent_run.updated_at, dispatch.updated_at),
					coalesce(latest_step.updated_at, dispatch.updated_at),
					coalesce(latest_failure_step.updated_at, dispatch.updated_at)
				) as "projected_at",
					assistant_message.kind as "assistant_kind",
					assistant_message.id is not null as "assistant_message_present",
					assistant_message.text as "assistant_message_text",
					assistant_message.structured_parts_json as "assistant_structured_parts_json",
					left(user_message.text, 280) as "question_preview",
					user_message.text as "question_text",
					char_length(user_message.text) > 280 as "question_truncated",
				dispatch.request_id as "request_id",
				nullif(agent_run.status, '') as "run_status",
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
						when latest_failure_step.step_id is not null then 1
						when dispatch.status = 'approval_required' then 2
						else null
					end as "attention_priority",
					case
						when dispatch.status in (
							'completed', 'error', 'rejected', 'approval_required', 'cancelled'
						) and assistant_message.id is null then 'RESULT_MISSING'
						when dispatch.status in ('error', 'rejected') then 'REQUEST_FAILED'
						when latest_failure_step.step_id is not null then 'EXECUTION_STAGE_FAILED'
						when dispatch.status = 'approval_required' then 'WAITING_USER'
						else null
					end as "attention_reason",
					nullif(agent_run.terminal_reason, '') as "terminal_reason"
			from "chat"."turn_dispatches" as dispatch
			join "chat"."messages" as user_message
				on user_message.id = dispatch.user_message_id
				left join "execution_control"."agent_runs" as agent_run
					on agent_run.request_id = dispatch.request_id
				left join lateral (
					select step.step_id, step.step_kind, step.status, step.sanitized_payload_json, step.updated_at
					from "execution_control"."agent_run_steps" as step
					where step.request_id = dispatch.request_id
					order by coalesce(step.started_at, step.updated_at) desc, step.step_id desc
					limit 1
				) as latest_step on true
				left join lateral (
					select step.step_id, step.sanitized_payload_json, step.updated_at
					from "execution_control"."agent_run_steps" as step
					where step.request_id = dispatch.request_id
						and (
							step.status = 'failed'
							or nullif(step.sanitized_payload_json -> 'failure' ->> 'code', '') is not null
						)
					order by step.updated_at desc,
						coalesce(step.started_at, step.updated_at) desc,
						step.step_id desc
					limit 1
				) as latest_failure_step on true
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
	addEquals(conditions, values, "request_id", query.requestId);
	if (query.q) {
		values.push(`%${escapeLikePattern(query.q)}%`);
		conditions.push(
			`("request_id" ilike $${values.length} or "question_preview" ilike $${values.length} or "error_code" ilike $${values.length} or "execution_failure_kind" ilike $${values.length})`,
		);
	}
	return {
		values,
		whereClause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
	};
}

export function requestStagesSql(): string {
	return `
		select
			"completed_at" as "completedAt",
			"sanitized_payload_json" as "sanitizedPayloadJson",
			"step_id" as "stepId",
			"started_at" as "startedAt",
			"status",
			"step_kind" as "stepKind",
			"updated_at" as "updatedAt"
		from "execution_control"."agent_run_steps"
		where "request_id" = $1
		order by coalesce("started_at", "updated_at") asc, "step_id" asc
		`;
}

export function requestModelAttemptsSql(): string {
	return `
		select
			"cached_input_tokens" as "cachedInputTokens",
			"completed_at" as "completedAt",
			"duration_ms" as "durationMs",
			"fail_close_reason" as "failCloseReason",
			"input_tokens" as "inputTokens",
			"model_name" as "modelName",
			"model_provider" as "modelProvider",
			"model_request_count" as "modelRequestCount",
			"output_tokens" as "outputTokens",
			"sanitized_payload_json" as "sanitizedPayloadJson",
			"started_at" as "startedAt",
			"status",
			"terminal_reason" as "terminalReason",
			"usage_observed" as "usageObserved"
		from "execution_control"."agent_step_attempts"
		where "request_id" = $1
		order by "step_id" asc, "attempt" asc
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
