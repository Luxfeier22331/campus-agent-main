package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) CreateRun(
	ctx context.Context,
	run execution.DurableRun,
) (execution.DurableRun, error) {
	if run.Status == "" {
		run.Status = execution.DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	runtimeVersionsJSON, err := jsonMapToBytes(run.RuntimeVersions)
	if err != nil {
		return execution.DurableRun{}, err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return execution.DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockOwnerDeletionInTx(ctx, tx, run.OwnerUserID); err != nil {
		return execution.DurableRun{}, err
	}
	var ownerDeletionState string
	ownerDeletionErr := tx.QueryRow(ctx, `
		select state from execution_control.owner_deletion_fences where owner_user_id = $1`, run.OwnerUserID).Scan(&ownerDeletionState)
	if ownerDeletionErr == nil {
		if execution.OwnerDeletionState(ownerDeletionState) == execution.OwnerDeletionStateDeleted {
			return execution.DurableRun{}, execution.ErrOwnerDeleted
		}
		return execution.DurableRun{}, execution.ErrOwnerDeletionNotDrained
	}
	if !errors.Is(ownerDeletionErr, pgx.ErrNoRows) {
		return execution.DurableRun{}, ownerDeletionErr
	}
	_, err = tx.Exec(
		ctx,
		`insert into execution_control.agent_runs (
			request_id, conversation_id, owner_user_id, surface,
			task_queue, status, terminal_reason,
			fail_close_reason, retryable, created_at, queued_at, admitted_at, started_at,
			streaming_started_at, completed_at, updated_at, runtime_versions_json,
			final_response_ref, request_fingerprint_sha256, metadata_json
		) values (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
			$17::jsonb,$18,$19,$20::jsonb
		)`,
		run.RequestID,
		run.ConversationID,
		run.OwnerUserID,
		run.Surface,
		run.TaskQueue,
		string(run.Status),
		string(run.TerminalReason),
		run.FailCloseReason,
		run.Retryable,
		run.CreatedAt,
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
		runtimeVersionsJSON,
		run.FinalResponseRef,
		run.RequestFingerprintSHA256,
		metadataJSON,
	)
	if err != nil {
		if isUniqueViolation(err) {
			_ = tx.Rollback(ctx)
			return execution.DurableRun{}, mapDurableRunUniqueViolation(ctx, s, run)
		}
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return s.GetRun(ctx, run.RequestID)
}

func (s *PostgresRunProjectionStore) DeleteRun(ctx context.Context, requestID string) error {
	commandTag, err := s.pool.Exec(ctx, `delete from execution_control.agent_runs where request_id = $1`, requestID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	return nil
}

func (s *PostgresRunProjectionStore) GetRun(ctx context.Context, requestID string) (execution.DurableRun, error) {
	run, err := scanDurableRun(
		s.pool.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1", requestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
		}
		return execution.DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) ReplaceRunMetadata(
	ctx context.Context,
	requestID string,
	metadata map[string]any,
) error {
	run, err := s.GetRun(ctx, requestID)
	if err != nil {
		return err
	}
	run.Metadata = cloneAnyMap(metadata)
	if err := execution.ValidateDurableRun(run); err != nil {
		return err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return err
	}
	commandTag, err := s.pool.Exec(
		ctx,
		`update execution_control.agent_runs set metadata_json = $2::jsonb, updated_at = $3 where request_id = $1`,
		requestID,
		metadataJSON,
		time.Now().UTC(),
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	return nil
}

func (s *PostgresRunProjectionStore) TransitionRun(
	ctx context.Context,
	requestID string,
	status execution.DurableRunStatus,
	terminalReason execution.DurableTerminalReason,
	now time.Time,
) (execution.DurableRun, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", requestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
		}
		return execution.DurableRun{}, err
	}
	if !execution.DurableRunTransitionAllowed(run.Status, status) {
		return execution.DurableRun{}, fmt.Errorf("%w: %s -> %s", execution.ErrInvalidRunTransition, run.Status, status)
	}
	run.Status = status
	run.TerminalReason = terminalReason
	run.UpdatedAt = now
	execution.RecordDurableRunStatusTimestamp(&run, status, now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9
		where request_id = $1`,
		run.RequestID,
		string(run.Status),
		string(run.TerminalReason),
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
	)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return s.GetRun(ctx, requestID)
}

func (s *PostgresRunProjectionStore) ExpireRunProjection(
	ctx context.Context,
	request execution.DurableRunExpireRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunExpireRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
		}
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusExpired {
		event, eventErr := durableRunEventByIDInTx(ctx, tx, run.RequestID+":run-expired")
		if eventErr != nil {
			if errors.Is(eventErr, pgx.ErrNoRows) {
				return execution.DurableRun{}, fmt.Errorf("%w: terminal event is missing", execution.ErrDurableRunExpiryConflict)
			}
			return execution.DurableRun{}, eventErr
		}
		if err := execution.ValidateDurableRunExpiryReplay(run, request, event); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RequestID); err != nil {
		return execution.DurableRun{}, err
	} else if requested {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusExpired) {
		return execution.DurableRun{}, fmt.Errorf("%w: %s -> %s", execution.ErrInvalidRunTransition, run.Status, execution.DurableRunStatusExpired)
	}
	run.Status = execution.DurableRunStatusExpired
	run.TerminalReason = execution.DurableTerminalReasonRunTimeout
	run.Retryable = true
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusExpired, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, execution.DurableRunExpiredEvent(run, request.Now)); err != nil {
		return execution.DurableRun{}, fmt.Errorf("%w: %v", execution.ErrDurableRunExpiryConflict, err)
	}
	if _, err := tx.Exec(ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and request_id = $2`,
		run.ConversationID, run.RequestID,
	); err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) CompleteRunProjection(
	ctx context.Context,
	request execution.DurableRunCompleteRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCompleteRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
		}
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted &&
		run.TerminalReason == request.TerminalReason &&
		run.FinalResponseRef == request.FinalResponseRef {
		if err := requireFinalizationResultInTx(ctx, tx, request); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RequestID); err != nil {
		return execution.DurableRun{}, err
	} else if requested {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusCompleted) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusCompleted,
		)
	}
	if err := requireFinalizationResultInTx(ctx, tx, request); err != nil {
		return execution.DurableRun{}, err
	}
	run.Status = execution.DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusCompleted, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			final_response_ref = $10
		where request_id = $1`,
		run.RequestID,
		string(run.Status),
		string(run.TerminalReason),
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
		run.FinalResponseRef,
	)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return s.GetRun(ctx, request.RequestID)
}

func requireFinalizationResultInTx(
	ctx context.Context,
	tx pgx.Tx,
	request execution.DurableRunCompleteRequest,
) error {
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from execution_control.agent_step_results
		where request_id = $1 and step_id = 'finalization.write' and status = 'completed'
			and result_kind = 'final_answer_projection' and projection_ref = $2
	)`, request.RequestID, request.FinalResponseRef).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf(
			"%w: matching completed finalization result is required",
			execution.ErrInvalidDurableRunComplete,
		)
	}
	return nil
}

func (s *PostgresRunProjectionStore) CancelRunProjection(
	ctx context.Context,
	request execution.DurableRunCancelRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCancelRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
		}
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusCanceled {
		return run, nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusCanceled) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusCanceled,
		)
	}
	run.Status = execution.DurableRunStatusCanceled
	run.TerminalReason = execution.DurableTerminalReasonUserCanceled
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusCanceled, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, execution.DurableRunEvent{
		EventID:              run.RequestID + ":run-canceled",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCanceled,
		OccurredAt:           request.Now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id":      run.RequestID,
			"status":          string(execution.DurableRunStatusCanceled),
			"terminal_reason": string(execution.DurableTerminalReasonUserCanceled),
		},
	}); err != nil {
		return execution.DurableRun{}, err
	}
	if _, err := tx.Exec(
		ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and request_id = $2`,
		run.ConversationID,
		run.RequestID,
	); err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) FailRunProjection(
	ctx context.Context,
	request execution.DurableRunFailRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunFailRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	request = execution.CanonicalizeDurableRunFailRequest(request)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
		}
		return execution.DurableRun{}, err
	}
	if err := execution.ValidateDurableRunFailureEventForRun(run, request.TerminalEvent); err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusFailed {
		terminalEvent, eventErr := durableRunEventByIDInTx(ctx, tx, request.TerminalEvent.EventID)
		if eventErr != nil {
			if errors.Is(eventErr, pgx.ErrNoRows) {
				return execution.DurableRun{}, fmt.Errorf(
					"%w: terminal event %s is missing",
					execution.ErrDurableRunFailureConflict,
					request.TerminalEvent.EventID,
				)
			}
			return execution.DurableRun{}, eventErr
		}
		if err := execution.ValidateDurableRunFailureReplay(run, request, terminalEvent); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RequestID); err != nil {
		return execution.DurableRun{}, err
	} else if requested {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusFailed) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusFailed,
		)
	}
	run.Status = execution.DurableRunStatusFailed
	run.TerminalReason = request.TerminalReason
	run.FailCloseReason = request.FailCloseReason
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusFailed, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			fail_close_reason = $10
		where request_id = $1`,
		run.RequestID,
		string(run.Status),
		string(run.TerminalReason),
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
		run.FailCloseReason,
	)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if _, err := tx.Exec(
		ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and request_id = $2`,
		run.ConversationID,
		run.RequestID,
	); err != nil {
		return execution.DurableRun{}, err
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.agent_memory_deliveries where request_id=$1 and status='prepared'`, run.RequestID); err != nil {
		return execution.DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.TerminalEvent); err != nil {
		if errors.Is(err, execution.ErrInvalidRunEvent) {
			return execution.DurableRun{}, fmt.Errorf("%w: %v", execution.ErrDurableRunFailureConflict, err)
		}
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

func mapDurableRunUniqueViolation(
	ctx context.Context,
	store *PostgresRunProjectionStore,
	run execution.DurableRun,
) error {
	var existingRunID string
	err := store.pool.QueryRow(
		ctx,
		`select request_id from execution_control.agent_runs
		where conversation_id = $1 and status in ('created', 'queued', 'admitted', 'running', 'streaming')
		limit 1`,
		run.ConversationID,
	).Scan(&existingRunID)
	if err == nil && existingRunID != run.RequestID {
		return fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			execution.ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	return fmt.Errorf("%w: %s", execution.ErrDurableRunExists, run.RequestID)
}

func scanDurableRun(row pgx.Row) (execution.DurableRun, error) {
	var run execution.DurableRun
	var taskQueue string
	var status string
	var terminalReason string
	var runtimeVersionsRaw []byte
	var metadataRaw []byte
	var queuedAt *time.Time
	var admittedAt *time.Time
	var startedAt *time.Time
	var streamingStartedAt *time.Time
	var completedAt *time.Time
	if err := row.Scan(
		&run.RequestID,
		&run.ConversationID,
		&run.OwnerUserID,
		&run.Surface,
		&taskQueue,
		&status,
		&terminalReason,
		&run.FailCloseReason,
		&run.Retryable,
		&run.CreatedAt,
		&queuedAt,
		&admittedAt,
		&startedAt,
		&streamingStartedAt,
		&completedAt,
		&run.UpdatedAt,
		&runtimeVersionsRaw,
		&run.FinalResponseRef,
		&run.RequestFingerprintSHA256,
		&metadataRaw,
	); err != nil {
		return execution.DurableRun{}, err
	}
	run.TaskQueue = taskQueue
	run.Status = execution.DurableRunStatus(status)
	run.TerminalReason = execution.DurableTerminalReason(terminalReason)
	if queuedAt != nil {
		run.QueuedAt = *queuedAt
	}
	if admittedAt != nil {
		run.AdmittedAt = *admittedAt
	}
	if startedAt != nil {
		run.StartedAt = *startedAt
	}
	if streamingStartedAt != nil {
		run.StreamingStartedAt = *streamingStartedAt
	}
	if completedAt != nil {
		run.CompletedAt = *completedAt
	}
	runtimeVersions, err := scanJSONMap(runtimeVersionsRaw)
	if err != nil {
		return execution.DurableRun{}, err
	}
	metadata, err := scanJSONMap(metadataRaw)
	if err != nil {
		return execution.DurableRun{}, err
	}
	run.RuntimeVersions = runtimeVersions
	run.Metadata = metadata
	return run, execution.ValidateDurableRun(run)
}

func nullableTime(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	return &value
}

const durableRunSelectSQL = `select
	request_id, conversation_id, owner_user_id, surface,
	task_queue, status, terminal_reason, fail_close_reason,
	retryable, created_at, queued_at, admitted_at, started_at, streaming_started_at, completed_at,
	updated_at, runtime_versions_json, final_response_ref, request_fingerprint_sha256, metadata_json
from execution_control.agent_runs`
