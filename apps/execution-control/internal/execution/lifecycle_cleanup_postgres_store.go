package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func insertRunCleanupInTx(ctx context.Context, tx pgx.Tx, run DurableRun) error {
	_, err := tx.Exec(ctx, `insert into runtime.agent_run_cleanups (
		run_id, state, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$3,$3)`, run.RunID, string(LifecycleIntentStatePending), run.CreatedAt)
	return err
}

func (s *PostgresRunProjectionStore) GetRunCleanup(
	ctx context.Context,
	runID string,
) (RunCleanup, error) {
	cleanup, err := scanRunCleanup(s.pool.QueryRow(
		ctx,
		runCleanupSelectSQL+" where run_id = $1",
		strings.TrimSpace(runID),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RunCleanup{}, fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, runID)
		}
		return RunCleanup{}, err
	}
	return cleanup, nil
}

func (s *PostgresRunProjectionStore) LeaseRunCleanups(
	ctx context.Context,
	request LifecycleLeaseRequest,
) ([]RunCleanup, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(
		ctx,
		runCleanupLeaseSQL,
		request.Now,
		request.Limit,
		request.LeaseToken,
		request.LeaseUntil,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cleanups := make([]RunCleanup, 0, request.Limit)
	for rows.Next() {
		cleanup, scanErr := scanRunCleanup(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		cleanups = append(cleanups, cleanup)
	}
	return cleanups, rows.Err()
}

func (s *PostgresRunProjectionStore) ConfirmRunCleanup(
	ctx context.Context,
	result RunCleanupResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid run cleanup confirmation", ErrLifecycleLeaseConflict)
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
	if !durableRunStatusIsTerminal(run.Status) {
		return fmt.Errorf("%w: run cleanup requires terminal run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	cleanup, err := scanRunCleanup(tx.QueryRow(ctx, runCleanupSelectSQL+" where run_id = $1 for update", result.RunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
		}
		return err
	}
	if cleanup.State == LifecycleIntentStateConfirmed {
		return nil
	}
	if cleanup.State != LifecycleIntentStateLeased || cleanup.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if _, err := tx.Exec(ctx, `update runtime.agent_run_cleanups
		set state = 'confirmed', lease_token = '', lease_until = null,
			last_error_code = '', confirmed_at = $2, updated_at = $2
		where run_id = $1`, result.RunID, result.Now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PostgresRunProjectionStore) RetryRunCleanup(
	ctx context.Context,
	result RunCleanupResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid run cleanup retry", ErrLifecycleLeaseConflict)
	}
	nextAttemptAt := result.NextAttemptAt
	if nextAttemptAt.IsZero() {
		nextAttemptAt = result.Now
	}
	tag, err := s.pool.Exec(ctx, `update runtime.agent_run_cleanups as cleanups
	set state = 'pending', next_attempt_at = $3, lease_token = '', lease_until = null,
		last_error_code = $4, updated_at = $5
	from runtime.agent_runs as runs
	where cleanups.run_id = $1 and cleanups.state = 'leased' and cleanups.lease_token = $2
		and runs.run_id = cleanups.run_id
		and runs.status in ('completed', 'failed', 'canceled', 'expired')`,
		result.RunID,
		result.LeaseToken,
		nextAttemptAt,
		strings.TrimSpace(result.ErrorCode),
		result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	return nil
}

func scanRunCleanup(row pgx.Row) (RunCleanup, error) {
	var cleanup RunCleanup
	var state string
	var leaseUntil *time.Time
	var confirmedAt *time.Time
	if err := row.Scan(
		&cleanup.RunID,
		&state,
		&cleanup.AttemptCount,
		&cleanup.NextAttemptAt,
		&cleanup.LeaseToken,
		&leaseUntil,
		&cleanup.LastErrorCode,
		&cleanup.CreatedAt,
		&confirmedAt,
		&cleanup.UpdatedAt,
	); err != nil {
		return RunCleanup{}, err
	}
	cleanup.State = LifecycleIntentState(state)
	if leaseUntil != nil {
		cleanup.LeaseUntil = *leaseUntil
	}
	if confirmedAt != nil {
		cleanup.ConfirmedAt = *confirmedAt
	}
	return cleanup, nil
}

const runCleanupSelectSQL = `select
	run_id, state, attempt_count, next_attempt_at, lease_token, lease_until,
	last_error_code, created_at, confirmed_at, updated_at
from runtime.agent_run_cleanups`

const runCleanupLeaseSQL = `with candidates as (
	select cleanups.run_id
	from runtime.agent_run_cleanups as cleanups
	join runtime.agent_runs as runs on runs.run_id = cleanups.run_id
	join runtime.agent_workflow_starts as starts on starts.run_id = cleanups.run_id
	where runs.status in ('completed', 'failed', 'canceled', 'expired')
	  and (
		(starts.state = 'confirmed' and btrim(starts.temporal_run_id) <> '')
		or (starts.state = 'permanent_failed' and not starts.dispatch_attempted
			and btrim(starts.temporal_run_id) = ''
			and starts.last_error_code = 'workflow_start_not_dispatched_invalid')
			or (starts.state = 'superseded' and not starts.dispatch_attempted
				and btrim(starts.temporal_run_id) = '')
			or (starts.state = 'superseded' and starts.dispatch_attempted
				and btrim(starts.temporal_run_id) <> '')
	  )
	  and cleanups.next_attempt_at <= $1
	  and (cleanups.state = 'pending' or (cleanups.state = 'leased' and cleanups.lease_until <= $1))
	order by cleanups.next_attempt_at, cleanups.created_at, cleanups.run_id
	for update of cleanups skip locked
	limit $2
)
update runtime.agent_run_cleanups as cleanups
set state = 'leased', lease_token = $3, lease_until = $4,
	attempt_count = cleanups.attempt_count + 1, updated_at = $1
from candidates
where cleanups.run_id = candidates.run_id
returning cleanups.run_id, cleanups.state, cleanups.attempt_count,
	cleanups.next_attempt_at, cleanups.lease_token, cleanups.lease_until,
	cleanups.last_error_code, cleanups.created_at, cleanups.confirmed_at, cleanups.updated_at`
