package execution

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) UpsertRunStep(
	ctx context.Context,
	step RunStepProjection,
) (RunStepProjection, error) {
	if err := validateRunStepProjection(step); err != nil {
		return RunStepProjection{}, err
	}
	payload, err := jsonMapToBytes(step.SanitizedPayload)
	if err != nil {
		return RunStepProjection{}, err
	}
	commandTag, err := s.pool.Exec(
		ctx,
		runProjectionPostgresRunStepUpsertSQL,
		step.StepID,
		step.RequestID,
		step.ConversationID,
		step.StepKind,
		step.Tool,
		step.ParentStepID,
		step.Status,
		step.ActivityAttempt,
		step.TaskQueue,
		step.WorkerID,
		nullableTime(step.StartedAt),
		nullableTime(step.CompletedAt),
		step.UpdatedAt,
		step.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return RunStepProjection{}, err
	}
	if commandTag.RowsAffected() == 0 {
		steps, listErr := s.ListRunSteps(ctx, step.RequestID)
		if listErr == nil {
			for _, current := range steps {
				if current.StepID == step.StepID && runStepProjectionEquivalent(current, step) {
					return current, nil
				}
			}
		}
		return RunStepProjection{}, fmt.Errorf(
			"%w: run=%s step=%s activity_attempt=%d",
			ErrStaleRunStepProjection,
			step.RequestID,
			step.StepID,
			step.ActivityAttempt,
		)
	}
	return step, nil
}

const runProjectionPostgresRunStepUpsertSQL = `insert into execution_control.agent_run_steps (
	step_id, request_id, conversation_id, step_kind, tool, parent_step_id,
	status, activity_attempt, task_queue, worker_id, started_at, completed_at, updated_at,
	payload_schema_version, sanitized_payload_json
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
on conflict (request_id, step_id) do update set
	conversation_id = excluded.conversation_id,
	step_kind = excluded.step_kind,
	tool = excluded.tool,
	parent_step_id = excluded.parent_step_id,
	status = excluded.status,
	activity_attempt = excluded.activity_attempt,
	task_queue = excluded.task_queue,
	worker_id = excluded.worker_id,
	started_at = coalesce(excluded.started_at, execution_control.agent_run_steps.started_at),
	completed_at = excluded.completed_at,
	updated_at = excluded.updated_at,
	payload_schema_version = excluded.payload_schema_version,
	sanitized_payload_json = excluded.sanitized_payload_json
where (execution_control.agent_run_steps.activity_attempt = 0
		or execution_control.agent_run_steps.activity_attempt <= excluded.activity_attempt)
	and not (
		execution_control.agent_run_steps.activity_attempt = excluded.activity_attempt
		and lower(btrim(execution_control.agent_run_steps.status)) in ('completed', 'failed', 'blocked', 'canceled', 'expired', 'skipped')
	)`

func (s *PostgresRunProjectionStore) UpsertStepAttempt(
	ctx context.Context,
	attempt StepAttemptProjection,
) (StepAttemptProjection, error) {
	if err := validateStepAttemptProjection(attempt); err != nil {
		return StepAttemptProjection{}, err
	}
	payload, err := jsonMapToBytes(attempt.SanitizedPayload)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	commandTag, err := s.pool.Exec(
		ctx,
		runProjectionPostgresStepAttemptUpsertSQL,
		attempt.AttemptID,
		attempt.StepID,
		attempt.RequestID,
		attempt.Attempt,
		attempt.Status,
		attempt.TaskQueue,
		attempt.WorkerID,
		attempt.WorkflowID,
		attempt.TemporalRunID,
		attempt.ActivityID,
		attempt.ActivityType,
		attempt.ActivityAttempt,
		nullableTime(attempt.ScheduledAt),
		nullableTime(attempt.StartedAt),
		nullableTime(attempt.CompletedAt),
		attempt.ScheduleToStartMS,
		attempt.DurationMS,
		attempt.ProviderRequestRef,
		attempt.ProviderResponseID,
		attempt.ModelProvider,
		attempt.ModelName,
		attempt.ModelRequestCount,
		attempt.InputTokens,
		attempt.OutputTokens,
		attempt.CachedInputTokens,
		attempt.UsageObserved,
		string(attempt.CancelOutcome),
		string(attempt.TimeoutOutcome),
		string(attempt.LateCompletionOutcome),
		attempt.FailCloseReason,
		attempt.TerminalReason,
		attempt.UpdatedAt,
		attempt.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	if commandTag.RowsAffected() == 0 {
		attempts, listErr := s.ListStepAttempts(ctx, attempt.RequestID)
		if listErr == nil {
			for _, current := range attempts {
				if current.AttemptID == attempt.AttemptID && stepAttemptProjectionEquivalent(current, attempt) {
					return current, nil
				}
			}
		}
		return StepAttemptProjection{}, fmt.Errorf(
			"%w: run=%s step=%s attempt_id=%s status=%s activity_attempt=%d",
			ErrStaleStepAttemptProjection,
			attempt.RequestID,
			attempt.StepID,
			attempt.AttemptID,
			attempt.Status,
			attempt.ActivityAttempt,
		)
	}
	return attempt, nil
}

const runProjectionPostgresStepAttemptUpsertSQL = `insert into execution_control.agent_step_attempts (
	attempt_id, step_id, request_id, attempt, status, task_queue, worker_id,
	workflow_id, temporal_run_id, activity_id, activity_type, activity_attempt,
	scheduled_at, started_at, completed_at, schedule_to_start_ms, duration_ms,
	provider_request_ref, provider_response_id, model_provider, model_name,
	model_request_count, input_tokens, output_tokens, cached_input_tokens, usage_observed,
	cancel_outcome, timeout_outcome, late_completion_outcome,
	fail_close_reason, terminal_reason, updated_at,
	payload_schema_version, sanitized_payload_json
) values (
	$1, $2, $3, $4, $5, $6, $7,
	$8, $9, $10, $11, $12,
	$13, $14, $15, $16, $17,
	$18, $19, $20, $21,
	$22, $23, $24, $25, $26,
	$27, $28, $29, $30, $31,
	$32, $33, $34
)
on conflict (attempt_id) do update set
	step_id = excluded.step_id,
	request_id = excluded.request_id,
	attempt = excluded.attempt,
	status = excluded.status,
	task_queue = excluded.task_queue,
	worker_id = excluded.worker_id,
	workflow_id = excluded.workflow_id,
	temporal_run_id = excluded.temporal_run_id,
	activity_id = excluded.activity_id,
	activity_type = excluded.activity_type,
	activity_attempt = excluded.activity_attempt,
	scheduled_at = coalesce(excluded.scheduled_at, execution_control.agent_step_attempts.scheduled_at),
	started_at = coalesce(excluded.started_at, execution_control.agent_step_attempts.started_at),
	completed_at = excluded.completed_at,
	schedule_to_start_ms = excluded.schedule_to_start_ms,
	duration_ms = excluded.duration_ms,
	provider_request_ref = excluded.provider_request_ref,
	provider_response_id = excluded.provider_response_id,
	model_provider = excluded.model_provider,
	model_name = excluded.model_name,
	model_request_count = case
		when excluded.usage_observed then excluded.model_request_count
		else execution_control.agent_step_attempts.model_request_count
	end,
	input_tokens = case
		when excluded.usage_observed then excluded.input_tokens
		else execution_control.agent_step_attempts.input_tokens
	end,
	output_tokens = case
		when excluded.usage_observed then excluded.output_tokens
		else execution_control.agent_step_attempts.output_tokens
	end,
	cached_input_tokens = case
		when excluded.usage_observed then excluded.cached_input_tokens
		else execution_control.agent_step_attempts.cached_input_tokens
	end,
	usage_observed = execution_control.agent_step_attempts.usage_observed or excluded.usage_observed,
	cancel_outcome = excluded.cancel_outcome,
	timeout_outcome = excluded.timeout_outcome,
	late_completion_outcome = excluded.late_completion_outcome,
	fail_close_reason = excluded.fail_close_reason,
	terminal_reason = excluded.terminal_reason,
	updated_at = excluded.updated_at,
	payload_schema_version = excluded.payload_schema_version,
	sanitized_payload_json = excluded.sanitized_payload_json
where execution_control.agent_step_attempts.request_id = excluded.request_id
	and execution_control.agent_step_attempts.step_id = excluded.step_id
	and execution_control.agent_step_attempts.attempt = excluded.attempt
	and (execution_control.agent_step_attempts.activity_attempt = 0
		or execution_control.agent_step_attempts.activity_attempt <= excluded.activity_attempt)
	and lower(btrim(execution_control.agent_step_attempts.status)) not in ('completed', 'failed', 'blocked', 'canceled', 'expired', 'skipped')`

func (s *PostgresRunProjectionStore) UpsertStepResult(
	ctx context.Context,
	result StepResultProjection,
) (StepResultProjection, error) {
	if err := validateStepResultProjection(result); err != nil {
		return StepResultProjection{}, err
	}
	var err error
	result, err = canonicalStepResultProjection(result)
	if err != nil {
		return StepResultProjection{}, err
	}
	payload, err := jsonMapToBytes(result.SanitizedPayload)
	if err != nil {
		return StepResultProjection{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return StepResultProjection{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var runStatus string
	if err := tx.QueryRow(
		ctx,
		`select status from execution_control.agent_runs where request_id = $1 for update`,
		result.RequestID,
	).Scan(&runStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return StepResultProjection{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RequestID)
		}
		return StepResultProjection{}, err
	}
	if !stepResultProjectionWriteAllowed(DurableRunStatus(runStatus), result) {
		return StepResultProjection{}, fmt.Errorf(
			"%w: run=%s status=%s",
			ErrDurableRunTerminalConflict,
			result.RequestID,
			runStatus,
		)
	}
	commandTag, err := tx.Exec(
		ctx,
		`insert into execution_control.agent_step_results (
			result_id, step_id, request_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		on conflict (result_id) do nothing`,
		result.ResultID,
		result.StepID,
		result.RequestID,
		result.AttemptID,
		result.Status,
		result.ResultKind,
		result.ProjectionRef,
		result.CreatedAt,
		result.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return StepResultProjection{}, err
	}
	if commandTag.RowsAffected() == 1 {
		if err := tx.Commit(ctx); err != nil {
			return StepResultProjection{}, err
		}
		return result, nil
	}
	existing, err := scanStepResultProjection(tx.QueryRow(
		ctx,
		`select result_id, step_id, request_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		from execution_control.agent_step_results
		where result_id = $1
		for update`,
		result.ResultID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return StepResultProjection{}, fmt.Errorf(
				"%w: result disappeared during replay: %s",
				ErrStepResultProjectionConflict,
				result.ResultID,
			)
		}
		return StepResultProjection{}, err
	}
	var payloadEquivalent bool
	if err := tx.QueryRow(
		ctx,
		`select sanitized_payload_json = $2::jsonb
		from execution_control.agent_step_results
		where result_id = $1`,
		result.ResultID,
		string(payload),
	).Scan(&payloadEquivalent); err != nil {
		return StepResultProjection{}, err
	}
	if !stepResultProjectionFieldsEquivalent(existing, result) || !payloadEquivalent {
		return existing, fmt.Errorf(
			"%w: run=%s result=%s",
			ErrStepResultProjectionConflict,
			result.RequestID,
			result.ResultID,
		)
	}
	if err := tx.Commit(ctx); err != nil {
		return StepResultProjection{}, err
	}
	return existing, nil
}

func (s *PostgresRunProjectionStore) ListRunSteps(
	ctx context.Context,
	requestID string,
) ([]RunStepProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select step_id, request_id, conversation_id, step_kind, tool, parent_step_id,
			status, activity_attempt, task_queue, worker_id, started_at, completed_at, updated_at,
			payload_schema_version, sanitized_payload_json
		from execution_control.agent_run_steps
		where request_id = $1
		order by started_at nulls last, step_id`,
		requestID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []RunStepProjection{}
	for rows.Next() {
		step, err := scanRunStepProjection(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		if _, err := s.GetRun(ctx, requestID); err != nil {
			return nil, err
		}
	}
	return steps, nil
}

func (s *PostgresRunProjectionStore) ListStepAttempts(
	ctx context.Context,
	requestID string,
) ([]StepAttemptProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select attempt_id, step_id, request_id, attempt, status, task_queue, worker_id,
			workflow_id, temporal_run_id, activity_id, activity_type, activity_attempt,
			scheduled_at, started_at, completed_at, schedule_to_start_ms, duration_ms,
			provider_request_ref, provider_response_id, model_provider, model_name,
			model_request_count, input_tokens, output_tokens, cached_input_tokens, usage_observed,
			cancel_outcome, timeout_outcome, late_completion_outcome,
			fail_close_reason, terminal_reason, updated_at,
			payload_schema_version, sanitized_payload_json
		from execution_control.agent_step_attempts
		where request_id = $1
		order by started_at nulls last, attempt_id`,
		requestID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := []StepAttemptProjection{}
	for rows.Next() {
		attempt, err := scanStepAttemptProjection(rows)
		if err != nil {
			return nil, err
		}
		attempts = append(attempts, attempt)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(attempts) == 0 {
		if _, err := s.GetRun(ctx, requestID); err != nil {
			return nil, err
		}
	}
	return attempts, nil
}

func (s *PostgresRunProjectionStore) ListStepResults(
	ctx context.Context,
	requestID string,
) ([]StepResultProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select result_id, step_id, request_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		from execution_control.agent_step_results
		where request_id = $1
		order by created_at, result_id`,
		requestID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []StepResultProjection{}
	for rows.Next() {
		result, err := scanStepResultProjection(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(results) == 0 {
		if _, err := s.GetRun(ctx, requestID); err != nil {
			return nil, err
		}
	}
	return results, nil
}

func scanRunStepProjection(row pgx.Row) (RunStepProjection, error) {
	var step RunStepProjection
	var payloadRaw []byte
	var startedAt *time.Time
	var completedAt *time.Time
	if err := row.Scan(
		&step.StepID,
		&step.RequestID,
		&step.ConversationID,
		&step.StepKind,
		&step.Tool,
		&step.ParentStepID,
		&step.Status,
		&step.ActivityAttempt,
		&step.TaskQueue,
		&step.WorkerID,
		&startedAt,
		&completedAt,
		&step.UpdatedAt,
		&step.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RunStepProjection{}, fmt.Errorf("%w", ErrInvalidRunStep)
		}
		return RunStepProjection{}, err
	}
	if startedAt != nil {
		step.StartedAt = *startedAt
	}
	if completedAt != nil {
		step.CompletedAt = *completedAt
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return RunStepProjection{}, err
	}
	step.SanitizedPayload = payload
	return step, nil
}

func scanStepAttemptProjection(row pgx.Row) (StepAttemptProjection, error) {
	var attempt StepAttemptProjection
	var payloadRaw []byte
	var scheduledAt *time.Time
	var startedAt *time.Time
	var completedAt *time.Time
	var cancelOutcome string
	var timeoutOutcome string
	var lateCompletionOutcome string
	if err := row.Scan(
		&attempt.AttemptID,
		&attempt.StepID,
		&attempt.RequestID,
		&attempt.Attempt,
		&attempt.Status,
		&attempt.TaskQueue,
		&attempt.WorkerID,
		&attempt.WorkflowID,
		&attempt.TemporalRunID,
		&attempt.ActivityID,
		&attempt.ActivityType,
		&attempt.ActivityAttempt,
		&scheduledAt,
		&startedAt,
		&completedAt,
		&attempt.ScheduleToStartMS,
		&attempt.DurationMS,
		&attempt.ProviderRequestRef,
		&attempt.ProviderResponseID,
		&attempt.ModelProvider,
		&attempt.ModelName,
		&attempt.ModelRequestCount,
		&attempt.InputTokens,
		&attempt.OutputTokens,
		&attempt.CachedInputTokens,
		&attempt.UsageObserved,
		&cancelOutcome,
		&timeoutOutcome,
		&lateCompletionOutcome,
		&attempt.FailCloseReason,
		&attempt.TerminalReason,
		&attempt.UpdatedAt,
		&attempt.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		return StepAttemptProjection{}, err
	}
	if scheduledAt != nil {
		attempt.ScheduledAt = *scheduledAt
	}
	if startedAt != nil {
		attempt.StartedAt = *startedAt
	}
	if completedAt != nil {
		attempt.CompletedAt = *completedAt
	}
	attempt.CancelOutcome = CancelOutcome(cancelOutcome)
	attempt.TimeoutOutcome = TimeoutOutcome(timeoutOutcome)
	attempt.LateCompletionOutcome = LateCompletionOutcome(lateCompletionOutcome)
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	attempt.SanitizedPayload = payload
	return attempt, nil
}

func scanStepResultProjection(row pgx.Row) (StepResultProjection, error) {
	var result StepResultProjection
	var payloadRaw []byte
	if err := row.Scan(
		&result.ResultID,
		&result.StepID,
		&result.RequestID,
		&result.AttemptID,
		&result.Status,
		&result.ResultKind,
		&result.ProjectionRef,
		&result.CreatedAt,
		&result.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		return StepResultProjection{}, err
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return StepResultProjection{}, err
	}
	result.SanitizedPayload = payload
	return result, nil
}
