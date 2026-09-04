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

func (s *PostgresRunProjectionStore) RequestRunCancellation(
	ctx context.Context,
	request execution.DurableRunCancellationRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCancellationRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
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
	var existingReason string
	existingCommandErr := tx.QueryRow(
		ctx,
		`select reason from execution_control.agent_run_cancellations where request_id = $1 for update`,
		run.RequestID,
	).Scan(&existingReason)
	if run.Status == execution.DurableRunStatusCanceled {
		if existingCommandErr == nil && existingReason != request.Reason {
			return execution.DurableRun{}, fmt.Errorf("%w: cancellation reason differs", execution.ErrDurableRunTerminalConflict)
		}
		if existingCommandErr != nil && !errors.Is(existingCommandErr, pgx.ErrNoRows) {
			return execution.DurableRun{}, existingCommandErr
		}
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return execution.DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return execution.DurableRun{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if existingCommandErr == nil {
		reason := existingReason
		if reason != request.Reason {
			return execution.DurableRun{}, fmt.Errorf("%w: cancellation reason differs", execution.ErrDurableRunTerminalConflict)
		}
		if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return execution.DurableRun{}, err
		}
		if err := requeueConfirmedCancellationInTx(ctx, tx, run.RequestID, request.Now); err != nil {
			return execution.DurableRun{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if !errors.Is(existingCommandErr, pgx.ErrNoRows) {
		return execution.DurableRun{}, existingCommandErr
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, execution.DurableRunEvent{
		EventID: run.RequestID + ":run-cancel-requested", RequestID: run.RequestID,
		ConversationID: run.ConversationID, EventType: execution.DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}); err != nil {
		return execution.DurableRun{}, err
	}
	_, err = tx.Exec(ctx, `insert into execution_control.agent_run_cancellations (
		request_id, workflow_id, reason, state, next_attempt_at, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$5,$5)`, run.RequestID, "campus-agent.chat."+run.RequestID,
		request.Reason, string(execution.LifecycleIntentStatePending), request.Now)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if err := supersedeWorkflowStartIntentInTx(ctx, tx, run.RequestID, request.Now); err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
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
	where request_id = $1 and state in ('pending', 'leased')`, requestID, string(execution.LifecycleIntentStateSuperseded), now)
	return err
}

func (s *PostgresRunProjectionStore) LeaseRunCancellationCommands(
	ctx context.Context,
	request execution.LifecycleLeaseRequest,
) ([]execution.RunCancellationCommand, error) {
	if err := execution.ValidateLifecycleLeaseRequest(request); err != nil {
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
	commands := make([]execution.RunCancellationCommand, 0, request.Limit)
	for rows.Next() {
		var command execution.RunCancellationCommand
		var state string
		var leaseUntil *time.Time
		if err := rows.Scan(
			&command.RequestID, &command.WorkflowID, &command.Reason, &state,
			&command.AttemptCount, &command.NextAttemptAt, &command.LeaseToken,
			&leaseUntil, &command.LastErrorCode, &command.CreatedAt, &command.UpdatedAt,
		); err != nil {
			return nil, err
		}
		command.State = execution.LifecycleIntentState(state)
		if leaseUntil != nil {
			command.LeaseUntil = *leaseUntil
		}
		commands = append(commands, command)
	}
	return commands, rows.Err()
}

func (s *PostgresRunProjectionStore) ConfirmRunCancellationCommand(
	ctx context.Context,
	result execution.RunCancellationCommandResult,
) error {
	return s.updateRunCancellationCommand(ctx, result, execution.LifecycleIntentStateConfirmed)
}

func (s *PostgresRunProjectionStore) RetryRunCancellationCommand(
	ctx context.Context,
	result execution.RunCancellationCommandResult,
) error {
	return s.updateRunCancellationCommand(ctx, result, execution.LifecycleIntentStatePending)
}

func (s *PostgresRunProjectionStore) updateRunCancellationCommand(
	ctx context.Context,
	result execution.RunCancellationCommandResult,
	state execution.LifecycleIntentState,
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
		return fmt.Errorf("%w: cancellation command request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
	}
	return nil
}
