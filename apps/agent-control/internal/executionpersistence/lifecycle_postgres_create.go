package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) CreateRunWithStartIntent(
	ctx context.Context,
	request execution.DurableRunCreateIntent,
) (execution.DurableRunCreateResult, error) {
	run := request.Run
	if run.Status == "" {
		run.Status = execution.DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	run.RequestFingerprintSHA256 = strings.TrimSpace(request.RequestFingerprintSHA256)
	if err := validateDurableRunCreateIntent(run, request); err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	runtimeVersionsJSON, err := jsonMapToBytes(run.RuntimeVersions)
	if err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	metadataJSON, err := jsonMapToBytes(run.Metadata)
	if err != nil {
		return execution.DurableRunCreateResult{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockOwnerDeletionInTx(ctx, tx, run.OwnerUserID); err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	existing, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", run.RequestID))
	if err == nil {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return execution.DurableRunCreateResult{Run: existing}, nil
		}
		return execution.DurableRunCreateResult{}, fmt.Errorf("%w: request_id=%s", execution.ErrDurableRunFingerprintConflict, run.RequestID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return execution.DurableRunCreateResult{}, err
	}
	var ownerDeletionState string
	ownerDeletionErr := tx.QueryRow(ctx, `
		select state from agent_control.owner_deletion_fences where owner_user_id = $1`, run.OwnerUserID).Scan(&ownerDeletionState)
	if ownerDeletionErr == nil {
		if execution.OwnerDeletionState(ownerDeletionState) == execution.OwnerDeletionStateDeleted {
			return execution.DurableRunCreateResult{}, execution.ErrOwnerDeleted
		}
		return execution.DurableRunCreateResult{}, execution.ErrOwnerDeletionNotDrained
	}
	if !errors.Is(ownerDeletionErr, pgx.ErrNoRows) {
		return execution.DurableRunCreateResult{}, ownerDeletionErr
	}

	_, err = tx.Exec(ctx, `insert into agent_control.agent_runs (
		request_id, conversation_id, owner_user_id, surface,
		task_queue, status, terminal_reason,
		fail_close_reason, retryable, created_at, queued_at, admitted_at, started_at,
		streaming_started_at, completed_at, updated_at, runtime_versions_json,
		final_response_ref, request_fingerprint_sha256, metadata_json
	) values (
		$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
		$17::jsonb,$18,$19,$20::jsonb
	)`,
		run.RequestID, run.ConversationID, run.OwnerUserID, run.Surface, run.TaskQueue,
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
		return execution.DurableRunCreateResult{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.CreatedEvent); err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	_, err = tx.Exec(ctx, `insert into agent_control.agent_workflow_starts (
		request_id, workflow_id, payload_sha256, task_queue, workflow_input_json, state,
		dispatch_attempted, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$4,$5::jsonb,$6,false,$7,$7,$7)`,
		run.RequestID, strings.TrimSpace(request.WorkflowID), strings.TrimSpace(request.PayloadSHA256),
		strings.TrimSpace(request.TaskQueue), request.WorkflowInputJSON,
		string(execution.LifecycleIntentStatePending), run.CreatedAt,
	)
	if err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRunCreateResult{}, err
	}
	return execution.DurableRunCreateResult{Run: run, Created: true}, nil
}

func (s *PostgresRunProjectionStore) resolveAtomicCreateConflict(
	ctx context.Context,
	run execution.DurableRun,
) (execution.DurableRunCreateResult, error) {
	existing, err := s.GetRun(ctx, run.RequestID)
	if err == nil {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return execution.DurableRunCreateResult{Run: existing}, nil
		}
		return execution.DurableRunCreateResult{}, fmt.Errorf("%w: request_id=%s", execution.ErrDurableRunFingerprintConflict, run.RequestID)
	}
	if !errors.Is(err, execution.ErrDurableRunNotFound) {
		return execution.DurableRunCreateResult{}, err
	}
	return execution.DurableRunCreateResult{}, mapDurableRunUniqueViolation(ctx, s, run)
}
