package execution

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const ownerDeletionActiveRunStatuses = "('created', 'queued', 'admitted', 'running', 'streaming')"

func lockOwnerDeletionInTx(ctx context.Context, tx pgx.Tx, ownerUserID string) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, ownerUserID)
	return err
}

func (s *PostgresRunProjectionStore) BeginOwnerDeletion(
	ctx context.Context,
	ownerUserID string,
	now time.Time,
) (OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" || now.IsZero() {
		return OwnerDeletionStatus{}, errors.New("owner deletion owner and timestamp are required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockOwnerDeletionInTx(ctx, tx, ownerUserID); err != nil {
		return OwnerDeletionStatus{}, err
	}
	if _, err := tx.Exec(ctx, `
		insert into execution_control.owner_deletion_fences(owner_user_id, state, started_at)
		values ($1, 'draining', $2)
		on conflict (owner_user_id) do nothing`, ownerUserID, now); err != nil {
		return OwnerDeletionStatus{}, err
	}
	state, err := ownerDeletionStateInTx(ctx, tx, ownerUserID)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	if state == OwnerDeletionStateDeleted {
		return OwnerDeletionStatus{OwnerUserID: ownerUserID, State: state}, nil
	}
	runIDs, err := ownerActiveRunIDsInTx(ctx, tx, ownerUserID)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	for _, runID := range runIDs {
		run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", runID))
		if err != nil {
			return OwnerDeletionStatus{}, err
		}
		if err := requestOwnerRunCancellationInTx(ctx, tx, run, now); err != nil {
			return OwnerDeletionStatus{}, err
		}
	}
	status, err := ownerDeletionStatusInTx(ctx, tx, ownerUserID)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OwnerDeletionStatus{}, err
	}
	return status, nil
}

func (s *PostgresRunProjectionStore) OwnerDeletionStatus(
	ctx context.Context,
	ownerUserID string,
) (OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" {
		return OwnerDeletionStatus{}, errors.New("owner deletion owner is required")
	}
	var state string
	err := s.pool.QueryRow(ctx, `
		select state from execution_control.owner_deletion_fences where owner_user_id = $1`, ownerUserID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return OwnerDeletionStatus{}, ErrOwnerDeletionNotStarted
	}
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	var activeRuns int
	if err := s.pool.QueryRow(ctx, `
		select count(*) from execution_control.agent_runs
		where owner_user_id = $1 and status in `+ownerDeletionActiveRunStatuses, ownerUserID).Scan(&activeRuns); err != nil {
		return OwnerDeletionStatus{}, err
	}
	return OwnerDeletionStatus{OwnerUserID: ownerUserID, State: OwnerDeletionState(state), ActiveRuns: activeRuns}, nil
}

func (s *PostgresRunProjectionStore) FinalizeOwnerDeletion(
	ctx context.Context,
	request OwnerDeletionFinalizeRequest,
) (OwnerDeletionStatus, error) {
	ownerUserID := strings.TrimSpace(request.OwnerUserID)
	if ownerUserID == "" || request.Now.IsZero() {
		return OwnerDeletionStatus{}, errors.New("owner deletion owner and timestamp are required")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := lockOwnerDeletionInTx(ctx, tx, ownerUserID); err != nil {
		return OwnerDeletionStatus{}, err
	}
	state, err := ownerDeletionStateInTx(ctx, tx, ownerUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OwnerDeletionStatus{}, ErrOwnerDeletionNotStarted
	}
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	if state == OwnerDeletionStateDeleted {
		status, statusErr := ownerDeletionStatusInTx(ctx, tx, ownerUserID)
		if statusErr != nil {
			return OwnerDeletionStatus{}, statusErr
		}
		if err := tx.Commit(ctx); err != nil {
			return OwnerDeletionStatus{}, err
		}
		return status, nil
	}
	status, err := ownerDeletionStatusInTx(ctx, tx, ownerUserID)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	if status.ActiveRuns > 0 {
		return status, ErrOwnerDeletionNotDrained
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.agent_runs where owner_user_id = $1`, ownerUserID); err != nil {
		return OwnerDeletionStatus{}, err
	}
	if _, err := tx.Exec(ctx, `
		update execution_control.owner_deletion_fences
		set state = 'deleted', deleted_at = $2
		where owner_user_id = $1`, ownerUserID, request.Now); err != nil {
		return OwnerDeletionStatus{}, err
	}
	status = OwnerDeletionStatus{OwnerUserID: ownerUserID, State: OwnerDeletionStateDeleted}
	if err := tx.Commit(ctx); err != nil {
		return OwnerDeletionStatus{}, err
	}
	return status, nil
}

func ownerDeletionStateInTx(ctx context.Context, tx pgx.Tx, ownerUserID string) (OwnerDeletionState, error) {
	var state string
	err := tx.QueryRow(ctx, `
		select state from execution_control.owner_deletion_fences where owner_user_id = $1 for update`, ownerUserID).Scan(&state)
	return OwnerDeletionState(state), err
}

func ownerActiveRunIDsInTx(ctx context.Context, tx pgx.Tx, ownerUserID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		select run_id from execution_control.agent_runs
		where owner_user_id = $1 and status in `+ownerDeletionActiveRunStatuses+
		` order by created_at, run_id for update`, ownerUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runIDs := []string{}
	for rows.Next() {
		var runID string
		if err := rows.Scan(&runID); err != nil {
			return nil, err
		}
		runIDs = append(runIDs, runID)
	}
	return runIDs, rows.Err()
}

func ownerDeletionStatusInTx(ctx context.Context, tx pgx.Tx, ownerUserID string) (OwnerDeletionStatus, error) {
	state, err := ownerDeletionStateInTx(ctx, tx, ownerUserID)
	if err != nil {
		return OwnerDeletionStatus{}, err
	}
	var activeRuns int
	if err := tx.QueryRow(ctx, `
		select count(*) from execution_control.agent_runs
		where owner_user_id = $1 and status in `+ownerDeletionActiveRunStatuses, ownerUserID).Scan(&activeRuns); err != nil {
		return OwnerDeletionStatus{}, err
	}
	return OwnerDeletionStatus{OwnerUserID: ownerUserID, State: state, ActiveRuns: activeRuns}, nil
}

func requestOwnerRunCancellationInTx(ctx context.Context, tx pgx.Tx, run DurableRun, now time.Time) error {
	var ignoredReason string
	err := tx.QueryRow(ctx, `
		select reason from execution_control.agent_run_cancellations where run_id = $1 for update`, run.RunID).Scan(&ignoredReason)
	if err == nil {
		return supersedeWorkflowStartIntentInTx(ctx, tx, run.RunID, now)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              run.RunID + ":run-cancel-requested",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunCancelRequested,
		OccurredAt:           now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested", "reason": "account_deletion"},
	}); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into execution_control.agent_run_cancellations (
			run_id, workflow_id, reason, state, next_attempt_at, created_at, updated_at
		) values ($1, $2, $3, 'pending', $4, $4, $4)`,
		run.RunID, "campus-agent.chat."+run.RunID, "account_deletion", now); err != nil {
		return err
	}
	return supersedeWorkflowStartIntentInTx(ctx, tx, run.RunID, now)
}
