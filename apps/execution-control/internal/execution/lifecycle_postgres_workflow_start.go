package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) LeaseWorkflowStartIntents(
	ctx context.Context,
	request LifecycleLeaseRequest,
) ([]WorkflowStartIntent, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `with candidates as (
		select starts.request_id from execution_control.agent_workflow_starts starts
		join execution_control.agent_runs runs on runs.request_id = starts.request_id
		where (
			runs.status in ('completed', 'failed', 'canceled', 'expired')
			or (
				runs.status in ('created', 'queued', 'admitted', 'running', 'streaming')
				and not exists (
					select 1 from execution_control.agent_run_cancellations cancellations
					where cancellations.request_id = starts.request_id
				)
			)
		  )
		  and starts.next_attempt_at <= $1
		  and (starts.state = 'pending' or (starts.state = 'leased' and starts.lease_until <= $1))
		order by starts.next_attempt_at, starts.created_at
		for update of starts skip locked
		limit $2
	)
	update execution_control.agent_workflow_starts as starts
	set state = 'leased', lease_token = $3, lease_until = $4,
		attempt_count = starts.attempt_count + 1, updated_at = $1
	from candidates where starts.request_id = candidates.request_id
	returning starts.request_id, starts.workflow_id, starts.payload_sha256, starts.task_queue,
		starts.workflow_input_json, starts.state, starts.temporal_run_id, starts.attempt_count,
		starts.dispatch_attempted, starts.next_attempt_at, starts.lease_token, starts.lease_until,
		starts.last_error_code, starts.created_at, starts.updated_at`,
		request.Now, request.Limit, request.LeaseToken, request.LeaseUntil,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	intents := make([]WorkflowStartIntent, 0, request.Limit)
	for rows.Next() {
		intent, err := scanWorkflowStartIntent(rows)
		if err != nil {
			return nil, err
		}
		intents = append(intents, intent)
	}
	return intents, rows.Err()
}

// GetWorkflowStartIntent returns the durable intent used to fence a stale
// reconciler snapshot before an external Temporal start call.
func (s *PostgresRunProjectionStore) GetWorkflowStartIntent(
	ctx context.Context,
	requestID string,
) (WorkflowStartIntent, error) {
	intent, err := scanWorkflowStartIntent(s.pool.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where request_id = $1",
		strings.TrimSpace(requestID),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, requestID)
		}
		return WorkflowStartIntent{}, err
	}
	return intent, nil
}

func (s *PostgresRunProjectionStore) MarkWorkflowStartDispatchAttempt(
	ctx context.Context,
	result WorkflowStartIntentResult,
) error {
	result.RequestID = strings.TrimSpace(result.RequestID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RequestID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start dispatch fence", ErrLifecycleLeaseConflict)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", result.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RequestID)
		}
		return err
	}
	if !durableRunStatusIsActive(run.Status) {
		return fmt.Errorf("%w: workflow start request_id=%s is not active", ErrLifecycleLeaseConflict, result.RequestID)
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where request_id = $1 for update",
		result.RequestID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
		}
		return err
	}
	if intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	var cancellationRequested bool
	if err := tx.QueryRow(ctx,
		`select exists(select 1 from execution_control.agent_run_cancellations where request_id = $1)`,
		result.RequestID,
	).Scan(&cancellationRequested); err != nil {
		return err
	}
	if cancellationRequested {
		return fmt.Errorf("%w: workflow start request_id=%s was canceled", ErrLifecycleLeaseConflict, result.RequestID)
	}
	tag, err := tx.Exec(ctx, `update execution_control.agent_workflow_starts
		set dispatch_attempted = true, updated_at = $3
		where request_id = $1 and state = 'leased' and lease_token = $2`,
		result.RequestID, result.LeaseToken, result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	return tx.Commit(ctx)
}

func (s *PostgresRunProjectionStore) BindSupersededWorkflowStartExecution(
	ctx context.Context,
	binding WorkflowStartExecutionBinding,
) (WorkflowStartIntent, error) {
	binding = canonicalWorkflowStartExecutionBinding(binding)
	if err := validateWorkflowStartExecutionBinding(binding); err != nil {
		return WorkflowStartIntent{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkflowStartIntent{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := scanDurableRun(tx.QueryRow(
		ctx,
		durableRunSelectSQL+" where request_id = $1 for update",
		binding.RequestID,
	)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, binding.RequestID)
		}
		return WorkflowStartIntent{}, err
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where request_id = $1 for update",
		binding.RequestID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: workflow start request_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RequestID,
			)
		}
		return WorkflowStartIntent{}, err
	}
	var cancellationWorkflowID string
	if err := tx.QueryRow(
		ctx,
		`select workflow_id from execution_control.agent_run_cancellations where request_id = $1`,
		binding.RequestID,
	).Scan(&cancellationWorkflowID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: cancellation identity request_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RequestID,
			)
		}
		return WorkflowStartIntent{}, err
	}
	if intent.RequestID != binding.RequestID || intent.WorkflowID != binding.WorkflowID ||
		strings.TrimSpace(cancellationWorkflowID) != binding.WorkflowID ||
		intent.State != LifecycleIntentStateSuperseded || !intent.DispatchAttempted {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start request_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	existingRunID := strings.TrimSpace(intent.TemporalRunID)
	if existingRunID != "" {
		if existingRunID != binding.TemporalRunID {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: temporal run id differs for request_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RequestID,
			)
		}
		return intent, nil
	}
	tag, err := tx.Exec(ctx, `update execution_control.agent_workflow_starts
		set temporal_run_id = $3, updated_at = $4
		where request_id = $1 and workflow_id = $2 and state = 'superseded'
			and dispatch_attempted and btrim(temporal_run_id) = ''`,
		binding.RequestID, binding.WorkflowID, binding.TemporalRunID, binding.Now,
	)
	if err != nil {
		return WorkflowStartIntent{}, err
	}
	if tag.RowsAffected() != 1 {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start request_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkflowStartIntent{}, err
	}
	intent.TemporalRunID = binding.TemporalRunID
	intent.UpdatedAt = binding.Now
	return intent, nil
}

func (s *PostgresRunProjectionStore) ListActiveWorkflowRuns(
	ctx context.Context,
	afterRunID string,
	limit int,
) ([]ActiveWorkflowRun, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("%w: active workflow limit must be positive", ErrInvalidDurableRun)
	}
	rows, err := s.pool.Query(ctx, `select
		starts.request_id, starts.workflow_id, starts.payload_sha256, starts.task_queue,
		starts.workflow_input_json, starts.state, starts.temporal_run_id, starts.attempt_count,
		starts.dispatch_attempted, starts.next_attempt_at, starts.lease_token, starts.lease_until,
		starts.last_error_code, starts.created_at, starts.updated_at
	from execution_control.agent_workflow_starts starts
	join execution_control.agent_runs runs on runs.request_id = starts.request_id
		where starts.state = 'confirmed'
		  and starts.request_id > $1
		  and runs.status in ('created', 'queued', 'admitted', 'running', 'streaming')
	  and not exists (
		select 1 from execution_control.agent_run_cancellations cancellations
		where cancellations.request_id = starts.request_id
		  and cancellations.state <> 'confirmed'
	  )
		order by starts.request_id
		limit $2`, strings.TrimSpace(afterRunID), limit)
	if err != nil {
		return nil, err
	}
	intents := make([]WorkflowStartIntent, 0, limit)
	for rows.Next() {
		intent, scanErr := scanWorkflowStartIntent(rows)
		if scanErr != nil {
			rows.Close()
			return nil, scanErr
		}
		intents = append(intents, intent)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	result := make([]ActiveWorkflowRun, 0, len(intents))
	for _, intent := range intents {
		run, getErr := s.GetRun(ctx, intent.RequestID)
		if getErr != nil {
			return nil, getErr
		}
		// The SQL snapshot already selected an active run. Keep every selected
		// row in the page even if it became terminal before this read; the
		// finalizer re-reads terminal state idempotently. Dropping it here would
		// shorten a full page and make the reconciler wrap before later run IDs.
		result = append(result, ActiveWorkflowRun{Run: run, StartIntent: intent})
	}
	return result, nil
}

func (s *PostgresRunProjectionStore) ConfirmWorkflowStartIntent(
	ctx context.Context,
	result WorkflowStartIntentResult,
) error {
	if strings.TrimSpace(result.TemporalRunID) == "" {
		return fmt.Errorf("%w: confirmed temporal run id is required", ErrLifecycleLeaseConflict)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Always lock the run before the start intent. Cancellation uses the same
	// order, so a late confirmation cannot race a cancel fence or deadlock it.
	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", result.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RequestID)
		}
		return err
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(ctx, workflowStartIntentSelectSQL+" where request_id = $1 for update", result.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
		}
		return err
	}
	if intent.State == LifecycleIntentStateConfirmed {
		if !intent.DispatchAttempted {
			return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RequestID)
		}
		if strings.TrimSpace(result.TemporalRunID) != "" &&
			strings.TrimSpace(result.TemporalRunID) != intent.TemporalRunID {
			return fmt.Errorf("%w: confirmed temporal run id differs for request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
		}
		return nil
	}
	if intent.State == LifecycleIntentStateSuperseded ||
		intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	if !intent.DispatchAttempted {
		return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RequestID)
	}
	var cancellationRequested bool
	if err := tx.QueryRow(ctx,
		`select exists(select 1 from execution_control.agent_run_cancellations where request_id = $1)`,
		result.RequestID,
	).Scan(&cancellationRequested); err != nil {
		return err
	}
	if cancellationRequested {
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, result.RequestID, result.Now); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}

	if run.Status == DurableRunStatusCreated {
		run.Status = DurableRunStatusQueued
		run.TerminalReason = ""
		run.UpdatedAt = result.Now
		recordDurableRunStatusTimestamp(&run, DurableRunStatusQueued, result.Now)
		if err := validateDurableRun(run); err != nil {
			return err
		}
		if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
			return err
		}
		if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
			EventID:              run.RequestID + ":workflow-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeWorkflowStarted,
			OccurredAt:           result.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusCreated),
				"workflow_id":     intent.WorkflowID,
				"temporal_run_id": strings.TrimSpace(result.TemporalRunID),
				"task_queue":      intent.TaskQueue,
			},
		}); err != nil {
			return err
		}
		if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
			EventID:              run.RequestID + ":run-queued",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunQueued,
			OccurredAt:           result.Now,
			Visibility:           DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(DurableRunStatusQueued)},
		}); err != nil {
			return err
		}
	}

	_, err = tx.Exec(ctx, `update execution_control.agent_workflow_starts
	set state = $3, temporal_run_id = $4, lease_token = '', lease_until = null,
		last_error_code = '', updated_at = $5
	where request_id = $1 and state = 'leased' and lease_token = $2`,
		result.RequestID, result.LeaseToken, string(LifecycleIntentStateConfirmed),
		strings.TrimSpace(result.TemporalRunID), result.Now)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (s *PostgresRunProjectionStore) RetryWorkflowStartIntent(
	ctx context.Context,
	result WorkflowStartIntentResult,
) error {
	return s.updateWorkflowStartIntent(ctx, result, LifecycleIntentStatePending)
}

func (s *PostgresRunProjectionStore) FailWorkflowStartIntent(
	ctx context.Context,
	result WorkflowStartIntentResult,
) error {
	return s.updateWorkflowStartIntent(ctx, result, LifecycleIntentStatePermanentFailed)
}

func (s *PostgresRunProjectionStore) updateWorkflowStartIntent(
	ctx context.Context,
	result WorkflowStartIntentResult,
	state LifecycleIntentState,
) error {
	nextAttemptAt := result.NextAttemptAt
	if nextAttemptAt.IsZero() {
		nextAttemptAt = result.Now
	}
	tag, err := s.pool.Exec(ctx, `update execution_control.agent_workflow_starts
	set state = $3, temporal_run_id = $4, next_attempt_at = $5,
		lease_token = '', lease_until = null, last_error_code = $6, updated_at = $7
	where request_id = $1 and state = 'leased' and lease_token = $2`,
		result.RequestID, result.LeaseToken, string(state), strings.TrimSpace(result.TemporalRunID),
		nextAttemptAt, strings.TrimSpace(result.ErrorCode), result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	return nil
}

func scanWorkflowStartIntent(row pgx.Row) (WorkflowStartIntent, error) {
	var intent WorkflowStartIntent
	var state string
	var leaseUntil *time.Time
	if err := row.Scan(
		&intent.RequestID, &intent.WorkflowID, &intent.PayloadSHA256, &intent.TaskQueue,
		&intent.WorkflowInputJSON, &state, &intent.TemporalRunID, &intent.AttemptCount,
		&intent.DispatchAttempted, &intent.NextAttemptAt, &intent.LeaseToken, &leaseUntil, &intent.LastErrorCode,
		&intent.CreatedAt, &intent.UpdatedAt,
	); err != nil {
		return WorkflowStartIntent{}, err
	}
	intent.State = LifecycleIntentState(state)
	if leaseUntil != nil {
		intent.LeaseUntil = *leaseUntil
	}
	return intent, nil
}

const workflowStartIntentSelectSQL = `select
	request_id, workflow_id, payload_sha256, task_queue, workflow_input_json, state,
	temporal_run_id, attempt_count, dispatch_attempted, next_attempt_at, lease_token, lease_until,
	last_error_code, created_at, updated_at
from execution_control.agent_workflow_starts`
