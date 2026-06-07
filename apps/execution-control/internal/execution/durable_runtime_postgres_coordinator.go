//go:build retired_pg_lease

package execution

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresDurableRuntimeStore) AcquireNextExecutionLease(
	ctx context.Context,
	request NextExecutionLeaseRequest,
) (ExecutionLease, error) {
	if err := validateNextExecutionLeaseRequest(request); err != nil {
		return ExecutionLease{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExecutionLease{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if _, err := scanExecutionLease(
		tx.QueryRow(ctx, executionLeaseSelectSQL+" where lease_id = $1", request.LeaseID),
	); err == nil {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id %s already exists",
			ErrExecutionLeaseConflict,
			request.LeaseID,
		)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ExecutionLease{}, err
	}
	run, err := scanDurableRun(tx.QueryRow(
		ctx,
		durableRunSelectSQL+`
		where lane = $1 and status = $2
		order by queued_at asc, created_at asc
		limit 1
		for update skip locked`,
		string(request.Lane),
		string(DurableRunStatusQueued),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecutionLease{}, fmt.Errorf("%w: lane=%s", ErrNoQueuedDurableRun, request.Lane)
		}
		return ExecutionLease{}, err
	}
	attempt, err := nextPostgresLeaseAttempt(ctx, tx, run.RunID, request.StepID)
	if err != nil {
		return ExecutionLease{}, err
	}
	leaseRequest := ExecutionLeaseRequest{
		LeaseID:   request.LeaseID,
		RunID:     run.RunID,
		StepID:    request.StepID,
		Lane:      request.Lane,
		WorkerID:  request.WorkerID,
		Attempt:   attempt,
		Now:       request.Now,
		ExpiresAt: request.ExpiresAt,
	}
	if err := validateNoActiveLeaseForStep(ctx, tx, leaseRequest); err != nil {
		return ExecutionLease{}, err
	}
	budget, err := s.getLaneBudgetLocked(ctx, tx, request.Lane)
	if err != nil {
		return ExecutionLease{}, err
	}
	if !budget.Enabled {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrLaneBudgetDisabled, request.Lane)
	}
	activeCount, err := activePostgresLeaseCountForLane(ctx, tx, request.Lane)
	if err != nil {
		return ExecutionLease{}, err
	}
	if activeCount >= budget.MaxActiveLeases {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrLaneBudgetExceeded, request.Lane)
	}
	heartbeat, err := s.getWorkerHeartbeatLocked(ctx, tx, request.WorkerID)
	if err != nil {
		return ExecutionLease{}, err
	}
	if err := validateWorkerCanLease(heartbeat, request.Lane, request.Now, budget); err != nil {
		return ExecutionLease{}, err
	}
	run.Status = DurableRunStatusAdmitted
	run.AdmittedAt = request.Now
	run.UpdatedAt = request.Now
	if err := validateDurableRun(run); err != nil {
		return ExecutionLease{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return ExecutionLease{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              request.LeaseID + ":run-admitted",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunAdmitted,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(DurableRunStatusAdmitted)},
	}); err != nil {
		return ExecutionLease{}, err
	}
	lease := ExecutionLease{
		LeaseID:     request.LeaseID,
		RunID:       run.RunID,
		StepID:      request.StepID,
		Lane:        request.Lane,
		WorkerID:    request.WorkerID,
		Attempt:     leaseRequest.Attempt,
		Status:      ExecutionLeaseStatusLeased,
		AcquiredAt:  request.Now,
		HeartbeatAt: request.Now,
		ExpiresAt:   request.ExpiresAt,
	}
	if err := validateExecutionLease(lease); err != nil {
		return ExecutionLease{}, err
	}
	if err := insertExecutionLeaseInTx(ctx, tx, lease); err != nil {
		return ExecutionLease{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              request.LeaseID + ":lease-acquired",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeLeaseAcquired,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"lease_id":  lease.LeaseID,
			"worker_id": lease.WorkerID,
			"step_id":   lease.StepID,
			"attempt":   lease.Attempt,
		},
	}); err != nil {
		return ExecutionLease{}, err
	}
	run.Status = DurableRunStatusRunning
	run.StartedAt = request.Now
	run.UpdatedAt = request.Now
	if err := validateDurableRun(run); err != nil {
		return ExecutionLease{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return ExecutionLease{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              request.LeaseID + ":run-started",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunStarted,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(DurableRunStatusRunning)},
	}); err != nil {
		return ExecutionLease{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ExecutionLease{}, err
	}
	return lease, nil
}

func nextPostgresLeaseAttempt(ctx context.Context, tx pgx.Tx, runID string, stepID string) (int, error) {
	var maxAttempt int
	err := tx.QueryRow(
		ctx,
		`select coalesce(max(attempt), 0) from runtime.execution_leases
		where run_id = $1 and step_id = $2`,
		runID,
		stepID,
	).Scan(&maxAttempt)
	if err != nil {
		return 0, err
	}
	return maxAttempt + 1, nil
}

func updateDurableRunStatusInTx(ctx context.Context, tx pgx.Tx, run DurableRun) error {
	_, err := tx.Exec(
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
	return err
}

func insertExecutionLeaseInTx(ctx context.Context, tx pgx.Tx, lease ExecutionLease) error {
	_, err := tx.Exec(
		ctx,
		`insert into runtime.execution_leases (
			lease_id, run_id, step_id, lane, worker_id, attempt, status,
			acquired_at, heartbeat_at, expires_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		lease.LeaseID,
		lease.RunID,
		lease.StepID,
		string(lease.Lane),
		lease.WorkerID,
		lease.Attempt,
		string(lease.Status),
		lease.AcquiredAt,
		lease.HeartbeatAt,
		lease.ExpiresAt,
	)
	if err != nil && isUniqueViolation(err) {
		return fmt.Errorf("%w: active lease or lease_id conflict", ErrExecutionLeaseConflict)
	}
	return err
}

func insertDurableRunEventInTx(
	ctx context.Context,
	tx pgx.Tx,
	run DurableRun,
	event DurableRunEvent,
) error {
	var nextSequence int64
	if err := tx.QueryRow(
		ctx,
		`select coalesce(max(sequence), 0) + 1 from runtime.agent_run_events where run_id = $1`,
		run.RunID,
	).Scan(&nextSequence); err != nil {
		return err
	}
	event.Sequence = nextSequence
	if event.ConversationID != run.ConversationID {
		return fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	if err := validateDurableRunEventBase(event); err != nil {
		return err
	}
	payloadJSON, err := jsonMapToBytes(event.Payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(
		ctx,
		`insert into runtime.agent_run_events (
			event_id, run_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
		event.EventID,
		event.RunID,
		event.ConversationID,
		event.Sequence,
		string(event.EventType),
		string(event.Visibility),
		event.PayloadSchemaVersion,
		payloadJSON,
		event.OccurredAt,
	)
	if err != nil && isUniqueViolation(err) {
		return fmt.Errorf("%w: event_id or sequence conflict", ErrInvalidRunEvent)
	}
	return err
}
