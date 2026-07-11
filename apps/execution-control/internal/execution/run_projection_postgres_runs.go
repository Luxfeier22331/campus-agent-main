package execution

import (
	"context"
	"errors"
	"fmt"
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
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.agent_runs (
			run_id, conversation_id, turn_id, request_id, trace_id, owner_user_id, surface,
			requested_tool, selected_tool, task_queue, status, terminal_reason,
			fail_close_reason, retryable, created_at, queued_at, admitted_at, started_at,
			streaming_started_at, completed_at, updated_at, runtime_versions_json,
			final_response_ref, metadata_json
		) values (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
			$22::jsonb,$23,$24::jsonb
		)`,
		run.RunID,
		run.ConversationID,
		run.TurnID,
		run.RequestID,
		run.TraceID,
		run.OwnerUserID,
		run.Surface,
		run.RequestedTool,
		run.SelectedTool,
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
		metadataJSON,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return DurableRun{}, mapDurableRunUniqueViolation(ctx, s, run)
		}
		return DurableRun{}, err
	}
	return s.GetRun(ctx, run.RunID)
}

func (s *PostgresRunProjectionStore) DeleteRun(ctx context.Context, runID string) error {
	commandTag, err := s.pool.Exec(ctx, `delete from runtime.agent_runs where run_id = $1`, runID)
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
		`update runtime.agent_runs set metadata_json = $2::jsonb, updated_at = $3 where run_id = $1`,
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
		`update runtime.agent_runs
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
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCompleted) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCompleted,
		)
	}
	run.Status = DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	if request.SelectedTool != "" {
		run.SelectedTool = request.SelectedTool
	}
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCompleted, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update runtime.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			final_response_ref = $10, selected_tool = $11
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
		run.SelectedTool,
	)
	if err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return s.GetRun(ctx, request.RunID)
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
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"status":          string(DurableRunStatusCanceled),
			"terminal_reason": string(DurableTerminalReasonUserCanceled),
			"reason":          request.Reason,
			"projection_only": true,
		},
	}); err != nil {
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
	if request.SelectedTool != "" {
		run.SelectedTool = request.SelectedTool
	}
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusFailed, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(
		ctx,
		`update runtime.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			selected_tool = $10
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
		run.SelectedTool,
	)
	if err != nil {
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
		`select run_id from runtime.agent_runs
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
		&run.RequestedTool,
		&run.SelectedTool,
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
	requested_tool, selected_tool, task_queue, status, terminal_reason, fail_close_reason,
	retryable, created_at, queued_at, admitted_at, started_at, streaming_started_at, completed_at,
	updated_at, runtime_versions_json, final_response_ref, metadata_json
from runtime.agent_runs`
