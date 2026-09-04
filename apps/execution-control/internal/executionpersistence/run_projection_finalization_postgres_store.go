package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) FinalizeRunProjection(
	ctx context.Context,
	request execution.RunProjectionFinalizeRequest,
) (execution.RunProjectionFinalizeResult, error) {
	request, err := execution.CanonicalizeRunProjectionFinalizeRequest(request)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.Completion.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, execution.ErrInvalidRunStep) {
			return execution.RunProjectionFinalizeResult{}, fmt.Errorf(
				"%w: %s",
				execution.ErrDurableRunNotFound,
				request.Completion.RequestID,
			)
		}
		return execution.RunProjectionFinalizeResult{}, err
	}
	if execution.DurableRunStatusIsTerminal(run.Status) && run.Status != execution.DurableRunStatusCompleted {
		return execution.RunProjectionFinalizeResult{}, fmt.Errorf(
			"%w: run status is %s",
			execution.ErrDurableRunTerminalConflict,
			run.Status,
		)
	}

	results, err := finalizationResultsInTx(ctx, tx, run.RequestID)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if len(results) > 1 {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"run %s has %d finalization results",
			run.RequestID,
			len(results),
		)
	}
	if len(results) == 1 {
		step, attempt, result, err := canonicalFinalizationRecordsInTx(ctx, tx, run, results[0])
		if err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := execution.ValidateCanonicalFinalizationRecords(
			run,
			request.Completion,
			step,
			attempt,
			result,
			request.FinalizationFingerprintSHA256,
		); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if run.Status == execution.DurableRunStatusCompleted {
			if !execution.DurableRunFinalizationReplayMatches(run, request.Completion) {
				return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
					"completed run identity differs from the request",
				)
			}
			if err := tx.Commit(ctx); err != nil {
				return execution.RunProjectionFinalizeResult{}, err
			}
			return cloneRunProjectionFinalizeResult(run, step, attempt, result), nil
		}

		completedRun, err := execution.CompleteDurableRunForFinalization(run, request.Completion)
		if err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := updateFinalizedRunInTx(ctx, tx, completedRun); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := completionWinsCancellationInTx(
			ctx,
			tx,
			run.RequestID,
			request.Completion.Now,
		); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := deleteConversationRunLockInTx(ctx, tx, completedRun); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		return cloneRunProjectionFinalizeResult(completedRun, step, attempt, result), nil
	}

	if run.Status == execution.DurableRunStatusCompleted {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"completed run is missing its canonical finalization result",
		)
	}
	if request.Step.ConversationID != run.ConversationID {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"candidate step conversation_id differs from the run",
		)
	}
	step, err := upsertFinalizationStepInTx(ctx, tx, request.Step)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	attempt, err := upsertFinalizationAttemptInTx(ctx, tx, request.Attempt)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	result, err := insertFinalizationResultInTx(ctx, tx, request.Result)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if err := execution.ValidateCanonicalFinalizationRecords(
		run,
		request.Completion,
		step,
		attempt,
		result,
		request.FinalizationFingerprintSHA256,
	); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	completedRun, err := execution.CompleteDurableRunForFinalization(run, request.Completion)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if err := updateFinalizedRunInTx(ctx, tx, completedRun); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if err := completionWinsCancellationInTx(
		ctx,
		tx,
		run.RequestID,
		request.Completion.Now,
	); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if err := deleteConversationRunLockInTx(ctx, tx, completedRun); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	return cloneRunProjectionFinalizeResult(completedRun, step, attempt, result), nil
}

func finalizationResultsInTx(
	ctx context.Context,
	tx pgx.Tx,
	requestID string,
) ([]execution.StepResultProjection, error) {
	rows, err := tx.Query(
		ctx,
		finalizationResultSelectSQL+` where request_id = $1 and step_id = $2
		order by created_at, result_id for update`,
		requestID,
		execution.FinalizationStepID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := make([]execution.StepResultProjection, 0, 1)
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
	return results, nil
}

func canonicalFinalizationRecordsInTx(
	ctx context.Context,
	tx pgx.Tx,
	run execution.DurableRun,
	result execution.StepResultProjection,
) (execution.RunStepProjection, execution.StepAttemptProjection, execution.StepResultProjection, error) {
	step, err := scanRunStepProjection(tx.QueryRow(
		ctx,
		finalizationStepSelectSQL+" where request_id = $1 and step_id = $2 for update",
		run.RequestID,
		result.StepID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
				execution.RunFinalizationConflict("canonical finalization step is missing")
		}
		return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{}, err
	}
	attempt, err := scanStepAttemptProjection(tx.QueryRow(
		ctx,
		finalizationAttemptSelectSQL+" where attempt_id = $1 for update",
		result.AttemptID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
				execution.RunFinalizationConflict("canonical finalization attempt is missing")
		}
		return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{}, err
	}
	return step, attempt, result, nil
}

func upsertFinalizationStepInTx(
	ctx context.Context,
	tx pgx.Tx,
	step execution.RunStepProjection,
) (execution.RunStepProjection, error) {
	payload, err := jsonMapToBytes(step.SanitizedPayload)
	if err != nil {
		return execution.RunStepProjection{}, execution.RunFinalizationConflict("encode finalization step payload: %v", err)
	}
	tag, err := tx.Exec(
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
		if isUniqueViolation(err) {
			return execution.RunStepProjection{}, execution.RunFinalizationConflict("finalization step identity is already bound")
		}
		return execution.RunStepProjection{}, fmt.Errorf("upsert finalization step: %w", err)
	}
	stored, err := scanRunStepProjection(tx.QueryRow(
		ctx,
		finalizationStepSelectSQL+" where request_id = $1 and step_id = $2 for update",
		step.RequestID,
		step.StepID,
	))
	if err != nil {
		return execution.RunStepProjection{}, err
	}
	if tag.RowsAffected() == 0 && !execution.RunStepProjectionEquivalent(stored, step) {
		return execution.RunStepProjection{}, execution.RunFinalizationConflict(
			"candidate finalization step conflicts with the canonical step",
		)
	}
	return stored, nil
}

func upsertFinalizationAttemptInTx(
	ctx context.Context,
	tx pgx.Tx,
	attempt execution.StepAttemptProjection,
) (execution.StepAttemptProjection, error) {
	if err := validateFinalizationAttemptNumberInTx(ctx, tx, attempt); err != nil {
		return execution.StepAttemptProjection{}, err
	}
	payload, err := jsonMapToBytes(attempt.SanitizedPayload)
	if err != nil {
		return execution.StepAttemptProjection{}, execution.RunFinalizationConflict("encode finalization attempt payload: %v", err)
	}
	tag, err := tx.Exec(
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
		if isUniqueViolation(err) {
			return execution.StepAttemptProjection{}, execution.RunFinalizationConflict(
				"finalization attempt identity is already bound",
			)
		}
		return execution.StepAttemptProjection{}, fmt.Errorf("upsert finalization attempt: %w", err)
	}
	stored, err := scanStepAttemptProjection(tx.QueryRow(
		ctx,
		finalizationAttemptSelectSQL+" where attempt_id = $1 for update",
		attempt.AttemptID,
	))
	if err != nil {
		return execution.StepAttemptProjection{}, err
	}
	if tag.RowsAffected() == 0 && !execution.StepAttemptProjectionEquivalent(stored, attempt) {
		return execution.StepAttemptProjection{}, execution.RunFinalizationConflict(
			"candidate finalization attempt conflicts with the canonical attempt",
		)
	}
	return stored, nil
}

func validateFinalizationAttemptNumberInTx(
	ctx context.Context,
	tx pgx.Tx,
	attempt execution.StepAttemptProjection,
) error {
	rows, err := tx.Query(
		ctx,
		`select attempt_id from execution_control.agent_step_attempts
		where request_id = $1 and step_id = $2 and attempt = $3
		for update`,
		attempt.RequestID,
		attempt.StepID,
		attempt.Attempt,
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var existingAttemptID string
		if err := rows.Scan(&existingAttemptID); err != nil {
			return err
		}
		if existingAttemptID != attempt.AttemptID {
			return execution.RunFinalizationConflict(
				"candidate attempt number is already bound to attempt_id %s",
				existingAttemptID,
			)
		}
	}
	return rows.Err()
}

func insertFinalizationResultInTx(
	ctx context.Context,
	tx pgx.Tx,
	result execution.StepResultProjection,
) (execution.StepResultProjection, error) {
	payload, err := jsonMapToBytes(result.SanitizedPayload)
	if err != nil {
		return execution.StepResultProjection{}, execution.RunFinalizationConflict("encode finalization result payload: %v", err)
	}
	_, err = tx.Exec(
		ctx,
		`insert into execution_control.agent_step_results (
			result_id, step_id, request_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
		if isUniqueViolation(err) {
			return execution.StepResultProjection{}, execution.RunFinalizationConflict(
				"finalization result identity is already bound",
			)
		}
		return execution.StepResultProjection{}, err
	}
	stored, err := scanStepResultProjection(tx.QueryRow(
		ctx,
		finalizationResultSelectSQL+" where result_id = $1 for update",
		result.ResultID,
	))
	if err != nil {
		return execution.StepResultProjection{}, err
	}
	if !execution.StepResultProjectionEquivalent(stored, result) {
		return execution.StepResultProjection{}, execution.RunFinalizationConflict(
			"stored finalization result differs from the candidate",
		)
	}
	return stored, nil
}

func updateFinalizedRunInTx(ctx context.Context, tx pgx.Tx, run execution.DurableRun) error {
	tag, err := tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, completed_at = $4, updated_at = $5,
			final_response_ref = $6
		where request_id = $1`,
		run.RequestID,
		string(run.Status),
		string(run.TerminalReason),
		run.CompletedAt,
		run.UpdatedAt,
		run.FinalResponseRef,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, run.RequestID)
	}
	return nil
}

func completionWinsCancellationInTx(
	ctx context.Context,
	tx pgx.Tx,
	requestID string,
	now time.Time,
) error {
	var state string
	err := tx.QueryRow(
		ctx,
		`select state from execution_control.agent_run_cancellations where request_id = $1 for update`,
		requestID,
	).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	switch execution.LifecycleIntentState(state) {
	case execution.LifecycleIntentStatePending,
		execution.LifecycleIntentStateLeased,
		execution.LifecycleIntentStateConfirmed,
		execution.LifecycleIntentStatePermanentFailed:
	default:
		return execution.RunFinalizationConflict("cancellation command has incompatible state %s", state)
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_run_cancellations
		set state = $2, next_attempt_at = $3, lease_token = '', lease_until = null,
			last_error_code = $4, updated_at = $3
		where request_id = $1`,
		requestID,
		string(execution.LifecycleIntentStateConfirmed),
		now,
		execution.FinalizationCompletionWonErrorCode,
	)
	return err
}

func deleteConversationRunLockInTx(
	ctx context.Context,
	tx pgx.Tx,
	run execution.DurableRun,
) error {
	_, err := tx.Exec(
		ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and request_id = $2`,
		run.ConversationID,
		run.RequestID,
	)
	return err
}

const finalizationStepSelectSQL = `select
	step_id, request_id, conversation_id, step_kind, tool, parent_step_id,
	status, activity_attempt, task_queue, worker_id, started_at, completed_at, updated_at,
	payload_schema_version, sanitized_payload_json
from execution_control.agent_run_steps`

const finalizationAttemptSelectSQL = `select
	attempt_id, step_id, request_id, attempt, status, task_queue, worker_id,
	workflow_id, temporal_run_id, activity_id, activity_type, activity_attempt,
	scheduled_at, started_at, completed_at, schedule_to_start_ms, duration_ms,
	provider_request_ref, provider_response_id, model_provider, model_name,
	model_request_count, input_tokens, output_tokens, cached_input_tokens, usage_observed,
	cancel_outcome, timeout_outcome, late_completion_outcome,
	fail_close_reason, terminal_reason, updated_at,
	payload_schema_version, sanitized_payload_json
from execution_control.agent_step_attempts`

const finalizationResultSelectSQL = `select
	result_id, step_id, request_id, attempt_id, status, result_kind, projection_ref,
	created_at, payload_schema_version, sanitized_payload_json
from execution_control.agent_step_results`
