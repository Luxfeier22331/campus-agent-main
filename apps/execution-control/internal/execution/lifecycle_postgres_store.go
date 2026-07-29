package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) CreateRunWithStartIntent(
	ctx context.Context,
	request DurableRunCreateIntent,
) (DurableRunCreateResult, error) {
	run := request.Run
	if run.Status == "" {
		run.Status = DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	run.RequestFingerprintSHA256 = strings.TrimSpace(request.RequestFingerprintSHA256)
	if err := validateDurableRunCreateIntent(run, request); err != nil {
		return DurableRunCreateResult{}, err
	}
	runtimeVersionsJSON, err := jsonMapToBytes(run.RuntimeVersions)
	if err != nil {
		return DurableRunCreateResult{}, err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return DurableRunCreateResult{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRunCreateResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	existing, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", run.RunID))
	if err == nil {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return DurableRunCreateResult{Run: existing}, nil
		}
		return DurableRunCreateResult{}, fmt.Errorf("%w: run_id=%s", ErrDurableRunFingerprintConflict, run.RunID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return DurableRunCreateResult{}, err
	}

	_, err = tx.Exec(ctx, `insert into runtime.agent_runs (
		run_id, conversation_id, turn_id, request_id, trace_id, owner_user_id, surface,
		task_queue, status, terminal_reason,
		fail_close_reason, retryable, created_at, queued_at, admitted_at, started_at,
		streaming_started_at, completed_at, updated_at, runtime_versions_json,
		final_response_ref, request_fingerprint_sha256, metadata_json
	) values (
		$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
		$20::jsonb,$21,$22,$23::jsonb
	)`,
		run.RunID, run.ConversationID, run.TurnID, run.RequestID, run.TraceID,
		run.OwnerUserID, run.Surface, run.TaskQueue,
		string(run.Status), string(run.TerminalReason), run.FailCloseReason, run.Retryable,
		run.CreatedAt, nullableTime(run.QueuedAt), nullableTime(run.AdmittedAt), nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt), nullableTime(run.CompletedAt), run.UpdatedAt,
		runtimeVersionsJSON, run.FinalResponseRef, run.RequestFingerprintSHA256, metadataJSON,
	)
	if err != nil {
		if isUniqueViolation(err) {
			_ = tx.Rollback(ctx)
			return s.resolveAtomicCreateConflict(ctx, run)
		}
		return DurableRunCreateResult{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.CreatedEvent); err != nil {
		return DurableRunCreateResult{}, err
	}
	_, err = tx.Exec(ctx, `insert into runtime.agent_workflow_starts (
		run_id, workflow_id, payload_sha256, task_queue, workflow_input_json, state,
		dispatch_attempted, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$4,$5::jsonb,$6,false,$7,$7,$7)`,
		run.RunID, strings.TrimSpace(request.WorkflowID), strings.TrimSpace(request.PayloadSHA256),
		strings.TrimSpace(request.TaskQueue), request.WorkflowInputJSON,
		string(LifecycleIntentStatePending), run.CreatedAt,
	)
	if err != nil {
		return DurableRunCreateResult{}, err
	}
	if err := insertRunCleanupInTx(ctx, tx, run); err != nil {
		return DurableRunCreateResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRunCreateResult{}, err
	}
	return DurableRunCreateResult{Run: run, Created: true}, nil
}

func (s *PostgresRunProjectionStore) resolveAtomicCreateConflict(
	ctx context.Context,
	run DurableRun,
) (DurableRunCreateResult, error) {
	existing, err := s.GetRun(ctx, run.RunID)
	if err == nil {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return DurableRunCreateResult{Run: existing}, nil
		}
		return DurableRunCreateResult{}, fmt.Errorf("%w: run_id=%s", ErrDurableRunFingerprintConflict, run.RunID)
	}
	if !errors.Is(err, ErrDurableRunNotFound) {
		return DurableRunCreateResult{}, err
	}
	return DurableRunCreateResult{}, mapDurableRunUniqueViolation(ctx, s, run)
}

func (s *PostgresRunProjectionStore) LeaseWorkflowStartIntents(
	ctx context.Context,
	request LifecycleLeaseRequest,
) ([]WorkflowStartIntent, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `with candidates as (
		select starts.run_id from runtime.agent_workflow_starts starts
		join runtime.agent_runs runs on runs.run_id = starts.run_id
		where (
			runs.status in ('completed', 'failed', 'canceled', 'expired')
			or (
				runs.status in ('created', 'queued', 'admitted', 'running', 'streaming')
				and not exists (
					select 1 from runtime.agent_run_cancellations cancellations
					where cancellations.run_id = starts.run_id
				)
			)
		  )
		  and starts.next_attempt_at <= $1
		  and (starts.state = 'pending' or (starts.state = 'leased' and starts.lease_until <= $1))
		order by starts.next_attempt_at, starts.created_at
		for update of starts skip locked
		limit $2
	)
	update runtime.agent_workflow_starts as starts
	set state = 'leased', lease_token = $3, lease_until = $4,
		attempt_count = starts.attempt_count + 1, updated_at = $1
	from candidates where starts.run_id = candidates.run_id
	returning starts.run_id, starts.workflow_id, starts.payload_sha256, starts.task_queue,
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
	runID string,
) (WorkflowStartIntent, error) {
	intent, err := scanWorkflowStartIntent(s.pool.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where run_id = $1",
		strings.TrimSpace(runID),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, runID)
		}
		return WorkflowStartIntent{}, err
	}
	return intent, nil
}

func (s *PostgresRunProjectionStore) MarkWorkflowStartDispatchAttempt(
	ctx context.Context,
	result WorkflowStartIntentResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start dispatch fence", ErrLifecycleLeaseConflict)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", result.RunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
		}
		return err
	}
	if !durableRunStatusIsActive(run.Status) {
		return fmt.Errorf("%w: workflow start run_id=%s is not active", ErrLifecycleLeaseConflict, result.RunID)
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where run_id = $1 for update",
		result.RunID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
		}
		return err
	}
	if intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	var cancellationRequested bool
	if err := tx.QueryRow(ctx,
		`select exists(select 1 from runtime.agent_run_cancellations where run_id = $1)`,
		result.RunID,
	).Scan(&cancellationRequested); err != nil {
		return err
	}
	if cancellationRequested {
		return fmt.Errorf("%w: workflow start run_id=%s was canceled", ErrLifecycleLeaseConflict, result.RunID)
	}
	tag, err := tx.Exec(ctx, `update runtime.agent_workflow_starts
		set dispatch_attempted = true, updated_at = $3
		where run_id = $1 and state = 'leased' and lease_token = $2`,
		result.RunID, result.LeaseToken, result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
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
		durableRunSelectSQL+" where run_id = $1 for update",
		binding.RunID,
	)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, binding.RunID)
		}
		return WorkflowStartIntent{}, err
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(
		ctx,
		workflowStartIntentSelectSQL+" where run_id = $1 for update",
		binding.RunID,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: workflow start run_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RunID,
			)
		}
		return WorkflowStartIntent{}, err
	}
	var cancellationWorkflowID string
	if err := tx.QueryRow(
		ctx,
		`select workflow_id from runtime.agent_run_cancellations where run_id = $1`,
		binding.RunID,
	).Scan(&cancellationWorkflowID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: cancellation identity run_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RunID,
			)
		}
		return WorkflowStartIntent{}, err
	}
	if intent.RunID != binding.RunID || intent.WorkflowID != binding.WorkflowID ||
		strings.TrimSpace(cancellationWorkflowID) != binding.WorkflowID ||
		intent.State != LifecycleIntentStateSuperseded || !intent.DispatchAttempted {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start run_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RunID,
		)
	}
	existingRunID := strings.TrimSpace(intent.TemporalRunID)
	if existingRunID != "" {
		if existingRunID != binding.TemporalRunID {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: temporal run id differs for run_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RunID,
			)
		}
		return intent, nil
	}
	tag, err := tx.Exec(ctx, `update runtime.agent_workflow_starts
		set temporal_run_id = $3, updated_at = $4
		where run_id = $1 and workflow_id = $2 and state = 'superseded'
			and dispatch_attempted and btrim(temporal_run_id) = ''`,
		binding.RunID, binding.WorkflowID, binding.TemporalRunID, binding.Now,
	)
	if err != nil {
		return WorkflowStartIntent{}, err
	}
	if tag.RowsAffected() != 1 {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start run_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RunID,
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
		starts.run_id, starts.workflow_id, starts.payload_sha256, starts.task_queue,
		starts.workflow_input_json, starts.state, starts.temporal_run_id, starts.attempt_count,
		starts.dispatch_attempted, starts.next_attempt_at, starts.lease_token, starts.lease_until,
		starts.last_error_code, starts.created_at, starts.updated_at
	from runtime.agent_workflow_starts starts
	join runtime.agent_runs runs on runs.run_id = starts.run_id
		where starts.state = 'confirmed'
		  and starts.run_id > $1
		  and runs.status in ('created', 'queued', 'admitted', 'running', 'streaming')
	  and not exists (
		select 1 from runtime.agent_run_cancellations cancellations
		where cancellations.run_id = starts.run_id
		  and cancellations.state <> 'confirmed'
	  )
		order by starts.run_id
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
		run, getErr := s.GetRun(ctx, intent.RunID)
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
	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", result.RunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
		}
		return err
	}
	intent, err := scanWorkflowStartIntent(tx.QueryRow(ctx, workflowStartIntentSelectSQL+" where run_id = $1 for update", result.RunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
		}
		return err
	}
	if intent.State == LifecycleIntentStateConfirmed {
		if !intent.DispatchAttempted {
			return fmt.Errorf("%w: workflow start run_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RunID)
		}
		if strings.TrimSpace(result.TemporalRunID) != "" &&
			strings.TrimSpace(result.TemporalRunID) != intent.TemporalRunID {
			return fmt.Errorf("%w: confirmed temporal run id differs for run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
		}
		return nil
	}
	if intent.State == LifecycleIntentStateSuperseded ||
		intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if !intent.DispatchAttempted {
		return fmt.Errorf("%w: workflow start run_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RunID)
	}
	var cancellationRequested bool
	if err := tx.QueryRow(ctx,
		`select exists(select 1 from runtime.agent_run_cancellations where run_id = $1)`,
		result.RunID,
	).Scan(&cancellationRequested); err != nil {
		return err
	}
	if cancellationRequested {
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, result.RunID, result.Now); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
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
			EventID:              run.RunID + ":workflow-started",
			RunID:                run.RunID,
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
			EventID:              run.RunID + ":run-queued",
			RunID:                run.RunID,
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

	_, err = tx.Exec(ctx, `update runtime.agent_workflow_starts
	set state = $3, temporal_run_id = $4, lease_token = '', lease_until = null,
		last_error_code = '', updated_at = $5
	where run_id = $1 and state = 'leased' and lease_token = $2`,
		result.RunID, result.LeaseToken, string(LifecycleIntentStateConfirmed),
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
	tag, err := s.pool.Exec(ctx, `update runtime.agent_workflow_starts
	set state = $3, temporal_run_id = $4, next_attempt_at = $5,
		lease_token = '', lease_until = null, last_error_code = $6, updated_at = $7
	where run_id = $1 and state = 'leased' and lease_token = $2`,
		result.RunID, result.LeaseToken, string(state), strings.TrimSpace(result.TemporalRunID),
		nextAttemptAt, strings.TrimSpace(result.ErrorCode), result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	return nil
}

func scanWorkflowStartIntent(row pgx.Row) (WorkflowStartIntent, error) {
	var intent WorkflowStartIntent
	var state string
	var leaseUntil *time.Time
	if err := row.Scan(
		&intent.RunID, &intent.WorkflowID, &intent.PayloadSHA256, &intent.TaskQueue,
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
	run_id, workflow_id, payload_sha256, task_queue, workflow_input_json, state,
	temporal_run_id, attempt_count, dispatch_attempted, next_attempt_at, lease_token, lease_until,
	last_error_code, created_at, updated_at
from runtime.agent_workflow_starts`

func (s *PostgresRunProjectionStore) RequestRunCancellation(
	ctx context.Context,
	request DurableRunCancellationRequest,
) (DurableRun, error) {
	if err := validateDurableRunCancellationRequest(request); err != nil {
		return DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return DurableRun{}, err
	}
	var existingReason string
	existingCommandErr := tx.QueryRow(
		ctx,
		`select reason from runtime.agent_run_cancellations where run_id = $1 for update`,
		run.RunID,
	).Scan(&existingReason)
	if run.Status == DurableRunStatusCanceled {
		if existingCommandErr == nil && existingReason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		if existingCommandErr != nil && !errors.Is(existingCommandErr, pgx.ErrNoRows) {
			return DurableRun{}, existingCommandErr
		}
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RunID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RunID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DurableRun{}, err
		}
		return run, nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if existingCommandErr == nil {
		reason := existingReason
		if reason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RunID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RunID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DurableRun{}, err
		}
		return run, nil
	}
	if !errors.Is(existingCommandErr, pgx.ErrNoRows) {
		return DurableRun{}, existingCommandErr
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID: run.RunID + ":run-cancel-requested", RunID: run.RunID,
		ConversationID: run.ConversationID, EventType: DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(ctx, `insert into runtime.agent_run_cancellations (
		run_id, workflow_id, reason, state, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$5,$5)`, run.RunID, "campus-agent.chat."+run.RunID,
		request.Reason, string(LifecycleIntentStatePending), request.Now)
	if err != nil {
		return DurableRun{}, err
	}
	if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RunID, request.Now); err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func requeueConfirmedCancellationInTx(ctx context.Context, tx pgx.Tx, runID string, now time.Time) error {
	_, err := tx.Exec(ctx, `update runtime.agent_run_cancellations
	set state = 'pending', next_attempt_at = $2, lease_token = '', lease_until = null,
		last_error_code = 'late_workflow_start', updated_at = $2
	where run_id = $1 and state = 'confirmed'`, runID, now)
	return err
}

func supersedeWorkflowStartIntentInTx(
	ctx context.Context,
	tx pgx.Tx,
	runID string,
	now time.Time,
) error {
	_, err := tx.Exec(ctx, `update runtime.agent_workflow_starts
	set state = $2, lease_token = '', lease_until = null, updated_at = $3
	where run_id = $1 and state in ('pending', 'leased')`, runID, string(LifecycleIntentStateSuperseded), now)
	return err
}

func (s *PostgresRunProjectionStore) LeaseRunCancellationCommands(
	ctx context.Context,
	request LifecycleLeaseRequest,
) ([]RunCancellationCommand, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `with candidates as (
		select run_id from runtime.agent_run_cancellations
		where next_attempt_at <= $1
		  and (state = 'pending' or (state = 'leased' and lease_until <= $1))
		order by next_attempt_at, created_at
		for update skip locked
		limit $2
	)
	update runtime.agent_run_cancellations as commands
	set state = 'leased', lease_token = $3, lease_until = $4,
		attempt_count = commands.attempt_count + 1, updated_at = $1
	from candidates where commands.run_id = candidates.run_id
	returning commands.run_id, commands.workflow_id, commands.reason, commands.state,
		commands.attempt_count, commands.next_attempt_at, commands.lease_token,
		commands.lease_until, commands.last_error_code, commands.created_at, commands.updated_at`,
		request.Now, request.Limit, request.LeaseToken, request.LeaseUntil,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	commands := make([]RunCancellationCommand, 0, request.Limit)
	for rows.Next() {
		var command RunCancellationCommand
		var state string
		var leaseUntil *time.Time
		if err := rows.Scan(
			&command.RunID, &command.WorkflowID, &command.Reason, &state,
			&command.AttemptCount, &command.NextAttemptAt, &command.LeaseToken,
			&leaseUntil, &command.LastErrorCode, &command.CreatedAt, &command.UpdatedAt,
		); err != nil {
			return nil, err
		}
		command.State = LifecycleIntentState(state)
		if leaseUntil != nil {
			command.LeaseUntil = *leaseUntil
		}
		commands = append(commands, command)
	}
	return commands, rows.Err()
}

func (s *PostgresRunProjectionStore) ConfirmRunCancellationCommand(
	ctx context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateRunCancellationCommand(ctx, result, LifecycleIntentStateConfirmed)
}

func (s *PostgresRunProjectionStore) RetryRunCancellationCommand(
	ctx context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateRunCancellationCommand(ctx, result, LifecycleIntentStatePending)
}

func (s *PostgresRunProjectionStore) updateRunCancellationCommand(
	ctx context.Context,
	result RunCancellationCommandResult,
	state LifecycleIntentState,
) error {
	nextAttemptAt := result.NextAttemptAt
	if nextAttemptAt.IsZero() {
		nextAttemptAt = result.Now
	}
	tag, err := s.pool.Exec(ctx, `update runtime.agent_run_cancellations
	set state = $3, next_attempt_at = $4, lease_token = '', lease_until = null,
		last_error_code = $5, updated_at = $6
	where run_id = $1 and state = 'leased' and lease_token = $2`,
		result.RunID, result.LeaseToken, string(state), nextAttemptAt,
		strings.TrimSpace(result.ErrorCode), result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: cancellation command run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	return nil
}

func (s *PostgresRunProjectionStore) BeginAgentInvocation(
	ctx context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, AgentInvocationDisposition, error) {
	if err := validateAgentInvocationReceipt(receipt, false); err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	tag, err := s.pool.Exec(ctx, `insert into runtime.agent_invocation_receipts (
		invocation_id, run_id, input_sha256, state, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$6) on conflict (invocation_id) do nothing`,
		receipt.InvocationID, receipt.RunID, receipt.InputSHA256,
		string(AgentInvocationReceiptStateStarted), receipt.CreatedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	stored, err := s.getAgentInvocationReceipt(ctx, receipt.InvocationID)
	if err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	if stored.RunID != receipt.RunID || stored.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if tag.RowsAffected() == 1 {
		return stored, AgentInvocationDispositionClaimed, nil
	}
	if stored.State == AgentInvocationReceiptStateCompleted {
		return stored, AgentInvocationDispositionReplay, nil
	}
	return stored, AgentInvocationDispositionAmbiguous, nil
}

func (s *PostgresRunProjectionStore) GetAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (AgentInvocationReceipt, error) {
	receipt, err := s.getAgentInvocationReceipt(ctx, strings.TrimSpace(invocationID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentInvocationReceipt{}, fmt.Errorf(
				"%w: invocation_id=%s",
				ErrAgentInvocationNotFound,
				strings.TrimSpace(invocationID),
			)
		}
		return AgentInvocationReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresRunProjectionStore) CompleteAgentInvocation(
	ctx context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, error) {
	if err := validateAgentInvocationReceipt(receipt, true); err != nil {
		return AgentInvocationReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stored, err := scanAgentInvocationReceipt(tx.QueryRow(ctx, `select invocation_id, run_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from runtime.agent_invocation_receipts where invocation_id = $1 for update`, receipt.InvocationID))
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	if stored.RunID != receipt.RunID || stored.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if stored.State == AgentInvocationReceiptStateCompleted {
		if stored.OutputSHA256 != receipt.OutputSHA256 {
			return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", ErrAgentInvocationConflict)
		}
		return stored, nil
	}
	_, err = tx.Exec(ctx, `update runtime.agent_invocation_receipts
	set state = $2, output_json = $3::jsonb, output_sha256 = $4,
		completed_at = $5, updated_at = $6 where invocation_id = $1`,
		receipt.InvocationID, string(AgentInvocationReceiptStateCompleted), receipt.OutputJSON,
		receipt.OutputSHA256, receipt.CompletedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AgentInvocationReceipt{}, err
	}
	receipt.State = AgentInvocationReceiptStateCompleted
	receipt.CreatedAt = stored.CreatedAt
	return receipt, nil
}

func (s *PostgresRunProjectionStore) getAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (AgentInvocationReceipt, error) {
	return scanAgentInvocationReceipt(s.pool.QueryRow(ctx, `select invocation_id, run_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from runtime.agent_invocation_receipts where invocation_id = $1`, invocationID))
}

func scanAgentInvocationReceipt(row pgx.Row) (AgentInvocationReceipt, error) {
	var receipt AgentInvocationReceipt
	var state string
	var outputJSON []byte
	var completedAt *time.Time
	if err := row.Scan(&receipt.InvocationID, &receipt.RunID, &receipt.InputSHA256, &state,
		&outputJSON, &receipt.OutputSHA256, &receipt.CreatedAt, &completedAt, &receipt.UpdatedAt); err != nil {
		return AgentInvocationReceipt{}, err
	}
	receipt.State = AgentInvocationReceiptState(state)
	receipt.OutputJSON = cloneRawMessage(outputJSON)
	if completedAt != nil {
		receipt.CompletedAt = *completedAt
	}
	return receipt, nil
}
