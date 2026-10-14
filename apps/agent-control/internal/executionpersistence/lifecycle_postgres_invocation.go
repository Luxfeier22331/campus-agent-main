package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/jackc/pgx/v5"
)

func (s *PostgresReceiptStore) BeginAgentInvocation(
	ctx context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, execution.AgentInvocationDisposition, error) {
	if err := execution.ValidateAgentInvocationReceipt(receipt, false); err != nil {
		return execution.AgentInvocationReceipt{}, "", err
	}
	tag, err := s.pool.Exec(ctx, `insert into agent_control.agent_invocation_receipts (
		invocation_id, request_id, input_sha256, state, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$6) on conflict (invocation_id) do nothing`,
		receipt.InvocationID, receipt.RequestID, receipt.InputSHA256,
		string(execution.AgentInvocationReceiptStateStarted), receipt.CreatedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return execution.AgentInvocationReceipt{}, "", err
	}
	stored, err := s.getAgentInvocationReceipt(ctx, receipt.InvocationID)
	if err != nil {
		return execution.AgentInvocationReceipt{}, "", err
	}
	if stored.RequestID != receipt.RequestID || stored.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if tag.RowsAffected() == 1 {
		return stored, execution.AgentInvocationDispositionClaimed, nil
	}
	if stored.State == execution.AgentInvocationReceiptStateCompleted || stored.State == execution.AgentInvocationReceiptStateFailed {
		return stored, execution.AgentInvocationDispositionReplay, nil
	}
	return stored, execution.AgentInvocationDispositionAmbiguous, nil
}

func (s *PostgresReceiptStore) GetAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (execution.AgentInvocationReceipt, error) {
	receipt, err := s.getAgentInvocationReceipt(ctx, strings.TrimSpace(invocationID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.AgentInvocationReceipt{}, fmt.Errorf(
				"%w: invocation_id=%s",
				execution.ErrAgentInvocationNotFound,
				strings.TrimSpace(invocationID),
			)
		}
		return execution.AgentInvocationReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresReceiptStore) CompleteAgentInvocation(
	ctx context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, error) {
	if receipt.State == "" {
		receipt.State = execution.AgentInvocationReceiptStateCompleted
	}
	if err := execution.ValidateAgentInvocationReceipt(receipt, true); err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stored, err := scanAgentInvocationReceipt(tx.QueryRow(ctx, `select invocation_id, request_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from agent_control.agent_invocation_receipts where invocation_id = $1 for update`, receipt.InvocationID))
	if err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	if stored.RequestID != receipt.RequestID || stored.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if stored.State == execution.AgentInvocationReceiptStateCompleted || stored.State == execution.AgentInvocationReceiptStateFailed {
		if stored.OutputSHA256 != receipt.OutputSHA256 || stored.State != receipt.State {
			return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", execution.ErrAgentInvocationConflict)
		}
		return stored, nil
	}
	_, err = tx.Exec(ctx, `update agent_control.agent_invocation_receipts
	set state = $2, output_json = $3::jsonb, output_sha256 = $4,
		completed_at = $5, updated_at = $6 where invocation_id = $1`,
		receipt.InvocationID, string(receipt.State), receipt.OutputJSON,
		receipt.OutputSHA256, receipt.CompletedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	if receipt.State != execution.AgentInvocationReceiptStateFailed {
		receipt.State = execution.AgentInvocationReceiptStateCompleted
	}
	receipt.CreatedAt = stored.CreatedAt
	return receipt, nil
}

func (s *PostgresReceiptStore) getAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (execution.AgentInvocationReceipt, error) {
	return scanAgentInvocationReceipt(s.pool.QueryRow(ctx, `select invocation_id, request_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from agent_control.agent_invocation_receipts where invocation_id = $1`, invocationID))
}

func scanAgentInvocationReceipt(row pgx.Row) (execution.AgentInvocationReceipt, error) {
	var receipt execution.AgentInvocationReceipt
	var state string
	var outputJSON []byte
	var completedAt *time.Time
	if err := row.Scan(&receipt.InvocationID, &receipt.RequestID, &receipt.InputSHA256, &state,
		&outputJSON, &receipt.OutputSHA256, &receipt.CreatedAt, &completedAt, &receipt.UpdatedAt); err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	receipt.State = execution.AgentInvocationReceiptState(state)
	receipt.OutputJSON = cloneRawMessage(outputJSON)
	if completedAt != nil {
		receipt.CompletedAt = *completedAt
	}
	return receipt, nil
}
