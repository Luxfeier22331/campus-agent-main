package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

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
	run, err := scanDurableRun(tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RequestID)
		}
		return DurableRun{}, err
	}
	var existingReason string
	existingCommandErr := tx.QueryRow(
		ctx,
		`select reason from execution_control.agent_run_cancellations where request_id = $1 for update`,
		run.RequestID,
	).Scan(&existingReason)
	if run.Status == DurableRunStatusCanceled {
		if existingCommandErr == nil && existingReason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		if existingCommandErr != nil && !errors.Is(existingCommandErr, pgx.ErrNoRows) {
			return DurableRun{}, existingCommandErr
		}
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RequestID, request.Now); err != nil {
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
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RequestID, request.Now); err != nil {
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
		EventID: run.RequestID + ":run-cancel-requested", RequestID: run.RequestID,
		ConversationID: run.ConversationID, EventType: DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}); err != nil {
		return DurableRun{}, err
	}
	_, err = tx.Exec(ctx, `insert into execution_control.agent_run_cancellations (
		request_id, workflow_id, reason, state, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$5,$5)`, run.RequestID, "campus-agent.chat."+run.RequestID,
		request.Reason, string(LifecycleIntentStatePending), request.Now)
	if err != nil {
		return DurableRun{}, err
	}
	if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func requeueConfirmedCancellationInTx(ctx context.Context, tx pgx.Tx, requestID string, now time.Time) error {
	_, err := tx.Exec(ctx, `update execution_control.agent_run_cancellations
	set state = 'pending', next_attempt_at = $2, lease_token = '', lease_until = null,
		last_error_code = 'late_workflow_start', updated_at = $2
	where request_id = $1 and state = 'confirmed'`, requestID, now)
	return err
}

func supersedeWorkflowStartIntentInTx(
	ctx context.Context,
	tx pgx.Tx,
	requestID string,
	now time.Time,
) error {
	_, err := tx.Exec(ctx, `update execution_control.agent_workflow_starts
	set state = $2, lease_token = '', lease_until = null, updated_at = $3
	where request_id = $1 and state in ('pending', 'leased')`, requestID, string(LifecycleIntentStateSuperseded), now)
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
		select request_id from execution_control.agent_run_cancellations
		where next_attempt_at <= $1
		  and (state = 'pending' or (state = 'leased' and lease_until <= $1))
		order by next_attempt_at, created_at
		for update skip locked
		limit $2
	)
	update execution_control.agent_run_cancellations as commands
	set state = 'leased', lease_token = $3, lease_until = $4,
		attempt_count = commands.attempt_count + 1, updated_at = $1
	from candidates where commands.request_id = candidates.request_id
	returning commands.request_id, commands.workflow_id, commands.reason, commands.state,
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
			&command.RequestID, &command.WorkflowID, &command.Reason, &state,
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
	tag, err := s.pool.Exec(ctx, `update execution_control.agent_run_cancellations
	set state = $3, next_attempt_at = $4, lease_token = '', lease_until = null,
		last_error_code = $5, updated_at = $6
	where request_id = $1 and state = 'leased' and lease_token = $2`,
		result.RequestID, result.LeaseToken, string(state), nextAttemptAt,
		strings.TrimSpace(result.ErrorCode), result.Now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: cancellation command request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	return nil
}
