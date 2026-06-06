package execution

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresDurableRuntimeStore) RecoverTimedOutRuns(
	ctx context.Context,
	request TimedOutRunRecoveryRequest,
) ([]TimedOutRunRecoveryResult, error) {
	if err := validateTimedOutRunRecoveryRequest(request); err != nil {
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
		durableRunSelectSQL+`
		where status in ($1,$2,$3,$4)
		order by updated_at asc
		for update skip locked`,
		string(DurableRunStatusQueued),
		string(DurableRunStatusAdmitted),
		string(DurableRunStatusRunning),
		string(DurableRunStatusStreaming),
	)
	if err != nil {
		return nil, err
	}
	runs := []DurableRun{}
	for rows.Next() {
		run, err := scanDurableRun(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	recovered := []TimedOutRunRecoveryResult{}
	for _, run := range runs {
		budget, err := s.getLaneBudgetLocked(ctx, tx, run.Lane)
		if err != nil {
			return nil, err
		}
		if !budget.Enabled {
			continue
		}
		terminalReason, timedOut := durableRunTimedOut(run, budget, request.Now)
		if !timedOut {
			continue
		}
		if err := expireActivePostgresLeaseForTimedOutRun(ctx, tx, run, request, terminalReason); err != nil {
			return nil, err
		}
		run.Status = DurableRunStatusExpired
		run.TerminalReason = terminalReason
		run.UpdatedAt = request.Now
		recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
		if err := validateDurableRun(run); err != nil {
			return nil, err
		}
		if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
			return nil, err
		}
		if err := insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
			EventID:              run.RunID + ":run-timeout",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusExpired),
				"terminal_reason": string(terminalReason),
			},
		}); err != nil {
			return nil, err
		}
		recovered = append(recovered, TimedOutRunRecoveryResult{
			Run:            run,
			TerminalReason: terminalReason,
		})
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return recovered, nil
}

func expireActivePostgresLeaseForTimedOutRun(
	ctx context.Context,
	tx pgx.Tx,
	run DurableRun,
	request TimedOutRunRecoveryRequest,
	terminalReason DurableTerminalReason,
) error {
	lease, err := scanExecutionLease(tx.QueryRow(
		ctx,
		executionLeaseSelectSQL+`
		where run_id = $1 and status = $2
		order by acquired_at asc
		limit 1
		for update`,
		run.RunID,
		string(ExecutionLeaseStatusLeased),
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	lease.Status = ExecutionLeaseStatusExpired
	lease.ReleasedAt = request.Now
	lease.ReleaseReason = string(terminalReason)
	if _, err := updateExecutionLeaseTerminal(ctx, tx, lease, request.Now); err != nil {
		return err
	}
	return insertDurableRunEventInTx(ctx, tx, run, DurableRunEvent{
		EventID:              lease.LeaseID + ":lease-timeout",
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
			"release_reason": string(terminalReason),
		},
	})
}
