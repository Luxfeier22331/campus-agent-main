package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) CreateRun(
	ctx context.Context,
	run DurableRun,
) (DurableRun, error) {
	if run.Status == "" {
		run.Status = DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	runtimeVersionsJSON, err := jsonMapToBytes(run.RuntimeVersions)
	if err != nil {
		return DurableRun{}, err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(
		ctx,
		`insert into execution_control.agent_runs (
			run_id, conversation_id, turn_id, request_id, trace_id, owner_user_id, surface,
			task_queue, status, terminal_reason,
			fail_close_reason, retryable, created_at, queued_at, admitted_at, started_at,
			streaming_started_at, completed_at, updated_at, runtime_versions_json,
			final_response_ref, request_fingerprint_sha256, metadata_json
		) values (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
			$20::jsonb,$21,$22,$23::jsonb
		)`,
		run.RunID,
		run.ConversationID,
		run.TurnID,
		run.RequestID,
		run.TraceID,
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
			return DurableRun{}, mapDurableRunUniqueViolation(ctx, s, run)
		}
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return s.GetRun(ctx, run.RunID)
}

func (s *PostgresRunProjectionStore) DeleteRun(ctx context.Context, runID string) error {
	commandTag, err := s.pool.Exec(ctx, `delete from execution_control.agent_runs where run_id = $1`, runID)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	return nil
}

func (s *PostgresRunProjectionStore) GetRun(ctx context.Context, runID string) (DurableRun, error) {
	run, err := scanDurableRun(
		s.pool.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1", runID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
		}
		return DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) ReplaceRunMetadata(
	ctx context.Context,
	runID string,
	metadata map[string]any,
) error {
	run, err := s.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	run.Metadata = cloneAnyMap(metadata)
	if err := validateDurableRun(run); err != nil {
		return err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return err
	}
	commandTag, err := s.pool.Exec(
		ctx,
		`update execution_control.agent_runs set metadata_json = $2::jsonb, updated_at = $3 where run_id = $1`,
		runID,
		metadataJSON,
		time.Now().UTC(),
	)
	if err != nil {
		return err
	}
	if commandTag.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	return nil
}

func (s *PostgresRunProjectionStore) TransitionRun(
	ctx context.Context,
	runID string,
	status DurableRunStatus,
	terminalReason DurableTerminalReason,
	now time.Time,
) (DurableRun, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", runID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
		}
		return DurableRun{}, err
	}
	if !durableRunTransitionAllowed(run.Status, status) {
		return DurableRun{}, fmt.Errorf("%w: %s -> %s", ErrInvalidRunTransition, run.Status, status)
	}
	run.Status = status
	run.TerminalReason = terminalReason
	run.UpdatedAt = now
	recordDurableRunStatusTimestamp(&run, status, now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9
		where run_id = $1`,
		run.RunID,
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
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return s.GetRun(ctx, runID)
}

func (s *PostgresRunProjectionStore) ExpireRunProjection(
	ctx context.Context,
	request DurableRunExpireRequest,
) (DurableRun, error) {
	if err := validateDurableRunExpireRequest(request); err != nil {
		return DurableRun{}, err
	}
	request.RunID = strings.TrimSpace(request.RunID)
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
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
	if run.Status == DurableRunStatusExpired {
		event, eventErr := durableRunEventByIDInTx(ctx, tx, run.RunID+":run-expired")
		if eventErr != nil {
			if errors.Is(eventErr, pgx.ErrNoRows) {
				return DurableRun{}, fmt.Errorf("%w: terminal event is missing", ErrDurableRunExpiryConflict)
			}
			return DurableRun{}, eventErr
		}
		if err := validateDurableRunExpiryReplay(run, request, event); err != nil {
			return DurableRun{}, err
		}
		return run, nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RunID); err != nil {
		return DurableRun{}, err
	} else if requested {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusExpired) {
		return DurableRun{}, fmt.Errorf("%w: %s -> %s", ErrInvalidRunTransition, run.Status, DurableRunStatusExpired)
	}
	run.Status = DurableRunStatusExpired
	run.TerminalReason = DurableTerminalReasonRunTimeout
	run.Retryable = true
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, durableRunExpiredEvent(run, request.Now)); err != nil {
		return DurableRun{}, fmt.Errorf("%w: %v", ErrDurableRunExpiryConflict, err)
	}
	if _, err := tx.Exec(ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and run_id = $2`,
		run.ConversationID, run.RunID,
	); err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) CompleteRunProjection(
	ctx context.Context,
	request DurableRunCompleteRequest,
) (DurableRun, error) {
	if err := validateDurableRunCompleteRequest(request); err != nil {
		return DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return DurableRun{}, err
	}
	if run.Status == DurableRunStatusCompleted &&
		run.TerminalReason == request.TerminalReason &&
		run.FinalResponseRef == request.FinalResponseRef {
		if err := requireFinalizationResultInTx(ctx, tx, request); err != nil {
			return DurableRun{}, err
		}
		return run, nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RunID); err != nil {
		return DurableRun{}, err
	} else if requested {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCompleted) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCompleted,
		)
	}
	if err := requireFinalizationResultInTx(ctx, tx, request); err != nil {
		return DurableRun{}, err
	}
	run.Status = DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCompleted, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			final_response_ref = $10
		where run_id = $1`,
		run.RunID,
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
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return s.GetRun(ctx, request.RunID)
}

func requireFinalizationResultInTx(
	ctx context.Context,
	tx pgx.Tx,
	request DurableRunCompleteRequest,
) error {
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from execution_control.agent_step_results
		where run_id = $1 and step_id = 'finalization.write' and status = 'completed'
			and result_kind = 'final_answer_projection' and projection_ref = $2
	)`, request.RunID, request.FinalResponseRef).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf(
			"%w: matching completed finalization result is required",
			ErrInvalidDurableRunComplete,
		)
	}
	return nil
}

func (s *PostgresRunProjectionStore) CancelRunProjection(
	ctx context.Context,
	request DurableRunCancelRequest,
) (DurableRun, error) {
	if err := validateDurableRunCancelRequest(request); err != nil {
		return DurableRun{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return DurableRun{}, err
	}
	if run.Status == DurableRunStatusCanceled {
		return run, nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCanceled) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCanceled,
		)
	}
	run.Status = DurableRunStatusCanceled
	run.TerminalReason = DurableTerminalReasonUserCanceled
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCanceled, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              run.RunID + ":run-canceled",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunCanceled,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id":      run.RequestID,
			"trace_id":        run.TraceID,
			"status":          string(DurableRunStatusCanceled),
			"terminal_reason": string(DurableTerminalReasonUserCanceled),
		},
	}); err != nil {
		return DurableRun{}, err
	}
	if _, err := tx.Exec(
		ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and run_id = $2`,
		run.ConversationID,
		run.RunID,
	); err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func (s *PostgresRunProjectionStore) FailRunProjection(
	ctx context.Context,
	request DurableRunFailRequest,
) (DurableRun, error) {
	if err := validateDurableRunFailRequest(request); err != nil {
		return DurableRun{}, err
	}
	request = canonicalizeDurableRunFailRequest(request)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return DurableRun{}, err
	}
	if err := validateDurableRunFailureEventForRun(run, request.TerminalEvent); err != nil {
		return DurableRun{}, err
	}
	if run.Status == DurableRunStatusFailed {
		terminalEvent, eventErr := durableRunEventByIDInTx(ctx, tx, request.TerminalEvent.EventID)
		if eventErr != nil {
			if errors.Is(eventErr, pgx.ErrNoRows) {
				return DurableRun{}, fmt.Errorf(
					"%w: terminal event %s is missing",
					ErrDurableRunFailureConflict,
					request.TerminalEvent.EventID,
				)
			}
			return DurableRun{}, eventErr
		}
		if err := validateDurableRunFailureReplay(run, request, terminalEvent); err != nil {
			return DurableRun{}, err
		}
		return run, nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if requested, err := runCancellationRequestedInTx(ctx, tx, run.RunID); err != nil {
		return DurableRun{}, err
	} else if requested {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusFailed) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusFailed,
		)
	}
	run.Status = DurableRunStatusFailed
	run.TerminalReason = request.TerminalReason
	run.FailCloseReason = request.FailCloseReason
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusFailed, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			fail_close_reason = $10
		where run_id = $1`,
		run.RunID,
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
		return DurableRun{}, err
	}
	if _, err := tx.Exec(
		ctx,
		`delete from execution_control.conversation_run_locks where conversation_id = $1 and run_id = $2`,
		run.ConversationID,
		run.RunID,
	); err != nil {
		return DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.TerminalEvent); err != nil {
		if errors.Is(err, ErrInvalidRunEvent) {
			return DurableRun{}, fmt.Errorf("%w: %v", ErrDurableRunFailureConflict, err)
		}
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func mapDurableRunUniqueViolation(
	ctx context.Context,
	store *PostgresRunProjectionStore,
	run DurableRun,
) error {
	var existingRunID string
	err := store.pool.QueryRow(
		ctx,
		`select run_id from execution_control.agent_runs
		where conversation_id = $1 and status in ('created', 'queued', 'admitted', 'running', 'streaming')
		limit 1`,
		run.ConversationID,
	).Scan(&existingRunID)
	if err == nil && existingRunID != run.RunID {
		return fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	return fmt.Errorf("%w: %s", ErrDurableRunExists, run.RunID)
}

func scanDurableRun(row pgx.Row) (DurableRun, error) {
	var run DurableRun
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
		&run.RunID,
		&run.ConversationID,
		&run.TurnID,
		&run.RequestID,
		&run.TraceID,
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
		return DurableRun{}, err
	}
	run.TaskQueue = taskQueue
	run.Status = DurableRunStatus(status)
	run.TerminalReason = DurableTerminalReason(terminalReason)
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
		return DurableRun{}, err
	}
	metadata, err := scanJSONMap(metadataRaw)
	if err != nil {
		return DurableRun{}, err
	}
	run.RuntimeVersions = runtimeVersions
	run.Metadata = metadata
	return run, validateDurableRun(run)
}

func nullableTime(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	return &value
}

const durableRunSelectSQL = `select
	run_id, conversation_id, turn_id, request_id, trace_id, owner_user_id, surface,
	task_queue, status, terminal_reason, fail_close_reason,
	retryable, created_at, queued_at, admitted_at, started_at, streaming_started_at, completed_at,
	updated_at, runtime_versions_json, final_response_ref, request_fingerprint_sha256, metadata_json
from execution_control.agent_runs`
