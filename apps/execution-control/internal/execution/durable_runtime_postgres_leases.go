//go:build retired_pg_lease

package execution

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type pgxQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *PostgresDurableRuntimeStore) AcquireExecutionLease(
	ctx context.Context,
	request ExecutionLeaseRequest,
) (ExecutionLease, error) {
	if err := validateExecutionLeaseRequest(request); err != nil {
		return ExecutionLease{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExecutionLease{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecutionLease{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return ExecutionLease{}, err
	}
	if run.Status != DurableRunStatusAdmitted {
		return ExecutionLease{}, fmt.Errorf(
			"%w: cannot lease run in status %s",
			ErrInvalidRunTransition,
			run.Status,
		)
	}
	if err := validateNoActiveLeaseForStep(ctx, tx, request); err != nil {
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
	lease := ExecutionLease{
		LeaseID:     request.LeaseID,
		RunID:       request.RunID,
		StepID:      request.StepID,
		Lane:        request.Lane,
		WorkerID:    request.WorkerID,
		Attempt:     request.Attempt,
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
	if err := tx.Commit(ctx); err != nil {
		return ExecutionLease{}, err
	}
	return lease, nil
}

func (s *PostgresDurableRuntimeStore) GetExecutionLease(
	ctx context.Context,
	leaseID string,
) (ExecutionLease, error) {
	lease, err := scanExecutionLease(
		s.pool.QueryRow(ctx, executionLeaseSelectSQL+" where lease_id = $1", leaseID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
		}
		return ExecutionLease{}, err
	}
	return lease, nil
}

func (s *PostgresDurableRuntimeStore) HeartbeatExecutionLease(
	ctx context.Context,
	leaseID string,
	workerID string,
	now time.Time,
	expiresAt time.Time,
) (ExecutionLease, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExecutionLease{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	lease, err := scanExecutionLease(
		tx.QueryRow(ctx, executionLeaseSelectSQL+" where lease_id = $1 for update", leaseID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
		}
		return ExecutionLease{}, err
	}
	if lease.WorkerID != workerID {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s worker_id=%s owner=%s",
			ErrExecutionLeaseDrift,
			leaseID,
			workerID,
			lease.WorkerID,
		)
	}
	if lease.Status != ExecutionLeaseStatusLeased {
		return ExecutionLease{}, fmt.Errorf(
			"%w: heartbeat requires leased status, got %s",
			ErrInvalidExecutionLease,
			lease.Status,
		)
	}
	if !expiresAt.After(now) {
		return ExecutionLease{}, fmt.Errorf(
			"%w: expires_at must be after heartbeat_at",
			ErrInvalidExecutionLease,
		)
	}
	lease.HeartbeatAt = now
	lease.ExpiresAt = expiresAt
	if _, err := tx.Exec(
		ctx,
		`update runtime.execution_leases
		set heartbeat_at = $2, expires_at = $3, updated_at = $4
		where lease_id = $1`,
		lease.LeaseID,
		lease.HeartbeatAt,
		lease.ExpiresAt,
		now,
	); err != nil {
		return ExecutionLease{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ExecutionLease{}, err
	}
	return lease, nil
}

func (s *PostgresDurableRuntimeStore) ReleaseExecutionLease(
	ctx context.Context,
	leaseID string,
	workerID string,
	releaseReason string,
	now time.Time,
) (ExecutionLease, error) {
	if releaseReason == "" {
		return ExecutionLease{}, fmt.Errorf("%w: release_reason is required", ErrInvalidExecutionLease)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExecutionLease{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	lease, err := scanExecutionLease(
		tx.QueryRow(ctx, executionLeaseSelectSQL+" where lease_id = $1 for update", leaseID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
		}
		return ExecutionLease{}, err
	}
	if lease.WorkerID != workerID {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s worker_id=%s owner=%s",
			ErrExecutionLeaseDrift,
			leaseID,
			workerID,
			lease.WorkerID,
		)
	}
	if lease.Status != ExecutionLeaseStatusLeased {
		return ExecutionLease{}, fmt.Errorf(
			"%w: release requires leased status, got %s",
			ErrInvalidExecutionLease,
			lease.Status,
		)
	}
	lease.Status = ExecutionLeaseStatusReleased
	lease.ReleasedAt = now
	lease.ReleaseReason = releaseReason
	if _, err := updateExecutionLeaseTerminal(ctx, tx, lease, now); err != nil {
		return ExecutionLease{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ExecutionLease{}, err
	}
	return lease, nil
}

func (s *PostgresDurableRuntimeStore) ExpireExecutionLeases(
	ctx context.Context,
	now time.Time,
	releaseReason string,
) ([]ExecutionLease, error) {
	if now.IsZero() {
		return nil, fmt.Errorf("%w: now is required", ErrInvalidExecutionLease)
	}
	if releaseReason == "" {
		return nil, fmt.Errorf("%w: release_reason is required", ErrInvalidExecutionLease)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	rows, err := tx.Query(
		ctx,
		executionLeaseSelectSQL+` where status = $1 and expires_at <= $2 for update`,
		string(ExecutionLeaseStatusLeased),
		now,
	)
	if err != nil {
		return nil, err
	}
	leases := []ExecutionLease{}
	for rows.Next() {
		lease, err := scanExecutionLease(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		leases = append(leases, lease)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	for index := range leases {
		leases[index].Status = ExecutionLeaseStatusExpired
		leases[index].ReleasedAt = now
		leases[index].ReleaseReason = releaseReason
		if _, err := updateExecutionLeaseTerminal(ctx, tx, leases[index], now); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return leases, nil
}

func (s *PostgresDurableRuntimeStore) RecoverExpiredExecutionLeases(
	ctx context.Context,
	request ExpiredLeaseRecoveryRequest,
) ([]ExpiredLeaseRecoveryResult, error) {
	if err := validateExpiredLeaseRecoveryRequest(request); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	rows, err := tx.Query(
		ctx,
		executionLeaseSelectSQL+` where status = $1 and expires_at <= $2 for update skip locked`,
		string(ExecutionLeaseStatusLeased),
		request.Now,
	)
	if err != nil {
		return nil, err
	}
	leases := []ExecutionLease{}
	for rows.Next() {
		lease, err := scanExecutionLease(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		leases = append(leases, lease)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	recovered := []ExpiredLeaseRecoveryResult{}
	for index := range leases {
		lease := leases[index]
		run, err := scanDurableRun(
			tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", lease.RunID),
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, lease.RunID)
			}
			return nil, err
		}
		if durableRunStatusIsTerminal(run.Status) {
			continue
		}
		lease.Status = ExecutionLeaseStatusExpired
		lease.ReleasedAt = request.Now
		lease.ReleaseReason = request.ReleaseReason
		if _, err := updateExecutionLeaseTerminal(ctx, tx, lease, request.Now); err != nil {
			return nil, err
		}
		if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
			EventID:              lease.LeaseID + ":lease-expired",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeLeaseExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"lease_id":       lease.LeaseID,
				"worker_id":      lease.WorkerID,
				"step_id":        lease.StepID,
				"attempt":        lease.Attempt,
				"release_reason": lease.ReleaseReason,
				"expires_at":     lease.ExpiresAt.Format(time.RFC3339Nano),
			},
		}); err != nil {
			return nil, err
		}
		if lease.Attempt < request.MaxRetryAttempts {
			run.Status = DurableRunStatusQueued
			run.TerminalReason = ""
			run.AdmittedAt = time.Time{}
			run.StartedAt = time.Time{}
			run.StreamingStartedAt = time.Time{}
			run.CompletedAt = time.Time{}
			run.UpdatedAt = request.Now
			recordDurableRunStatusTimestamp(&run, DurableRunStatusQueued, request.Now)
			if err := validateDurableRun(run); err != nil {
				return nil, err
			}
			if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
				return nil, err
			}
			if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
				EventID:              lease.LeaseID + ":run-retry-queued",
				RunID:                run.RunID,
				ConversationID:       run.ConversationID,
				EventType:            DurableRunEventTypeRunQueued,
				OccurredAt:           request.Now,
				Visibility:           DurableRunEventVisibilityInternal,
				PayloadSchemaVersion: "run-event-v1",
				Payload: map[string]any{
					"status":             string(DurableRunStatusQueued),
					"retry_reason":       request.ReleaseReason,
					"lease_id":           lease.LeaseID,
					"expired_attempt":    lease.Attempt,
					"next_attempt":       lease.Attempt + 1,
					"max_retry_attempts": request.MaxRetryAttempts,
				},
			}); err != nil {
				return nil, err
			}
			recovered = append(recovered, ExpiredLeaseRecoveryResult{
				Lease: lease,
				Run:   run,
			})
			continue
		}
		run.Status = DurableRunStatusExpired
		run.TerminalReason = request.TerminalReason
		run.UpdatedAt = request.Now
		recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
		if err := validateDurableRun(run); err != nil {
			return nil, err
		}
		if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
			return nil, err
		}
		if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
			EventID:              lease.LeaseID + ":run-expired",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusExpired),
				"terminal_reason": string(request.TerminalReason),
				"lease_id":        lease.LeaseID,
				"attempt":         lease.Attempt,
			},
		}); err != nil {
			return nil, err
		}
		recovered = append(recovered, ExpiredLeaseRecoveryResult{
			Lease: lease,
			Run:   run,
		})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return recovered, nil
}

func validateNoActiveLeaseForStep(
	ctx context.Context,
	tx pgx.Tx,
	request ExecutionLeaseRequest,
) error {
	var existingLeaseID string
	err := tx.QueryRow(
		ctx,
		`select lease_id from runtime.execution_leases
		where run_id = $1 and step_id = $2 and status = $3
		limit 1`,
		request.RunID,
		request.StepID,
		string(ExecutionLeaseStatusLeased),
	).Scan(&existingLeaseID)
	if err == nil {
		return fmt.Errorf(
			"%w: active lease %s for run_id=%s step_id=%s",
			ErrExecutionLeaseConflict,
			existingLeaseID,
			request.RunID,
			request.StepID,
		)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

func activePostgresLeaseCountForLane(
	ctx context.Context,
	tx pgxQueryer,
	lane DurableLane,
) (int, error) {
	var activeCount int
	err := tx.QueryRow(
		ctx,
		`select count(*) from runtime.execution_leases where lane = $1 and status = $2`,
		string(lane),
		string(ExecutionLeaseStatusLeased),
	).Scan(&activeCount)
	return activeCount, err
}

func updateExecutionLeaseTerminal(
	ctx context.Context,
	tx pgx.Tx,
	lease ExecutionLease,
	now time.Time,
) (ExecutionLease, error) {
	_, err := tx.Exec(
		ctx,
		`update runtime.execution_leases
		set status = $2, released_at = $3, release_reason = $4, updated_at = $5
		where lease_id = $1`,
		lease.LeaseID,
		string(lease.Status),
		nullableTime(lease.ReleasedAt),
		lease.ReleaseReason,
		now,
	)
	return lease, err
}

func scanExecutionLease(row pgx.Row) (ExecutionLease, error) {
	var lease ExecutionLease
	var lane string
	var status string
	var releasedAt *time.Time
	if err := row.Scan(
		&lease.LeaseID,
		&lease.RunID,
		&lease.StepID,
		&lane,
		&lease.WorkerID,
		&lease.Attempt,
		&status,
		&lease.AcquiredAt,
		&lease.HeartbeatAt,
		&lease.ExpiresAt,
		&releasedAt,
		&lease.ReleaseReason,
	); err != nil {
		return ExecutionLease{}, err
	}
	lease.Lane = DurableLane(lane)
	lease.Status = ExecutionLeaseStatus(status)
	if releasedAt != nil {
		lease.ReleasedAt = *releasedAt
	}
	return lease, validateExecutionLeaseTerminalAllowed(lease)
}

func validateExecutionLeaseTerminalAllowed(lease ExecutionLease) error {
	if lease.Status == ExecutionLeaseStatusReleased || lease.Status == ExecutionLeaseStatusExpired ||
		lease.Status == ExecutionLeaseStatusRevoked {
		if lease.ReleaseReason == "" {
			return fmt.Errorf("%w: release_reason is required", ErrInvalidExecutionLease)
		}
		return nil
	}
	return validateExecutionLease(lease)
}

const executionLeaseSelectSQL = `select
	lease_id, run_id, step_id, lane, worker_id, attempt, status, acquired_at, heartbeat_at,
	expires_at, released_at, release_reason
from runtime.execution_leases`
