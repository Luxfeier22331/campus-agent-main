package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) BeginAgentInvocation(
	ctx context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, AgentInvocationDisposition, error) {
	if err := validateAgentInvocationReceipt(receipt, false); err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	tag, err := s.pool.Exec(ctx, `insert into execution_control.agent_invocation_receipts (
		invocation_id, request_id, input_sha256, state, created_at, updated_at
	) values ($1,$2,$3,$4,$5,$6) on conflict (invocation_id) do nothing`,
		receipt.InvocationID, receipt.RequestID, receipt.InputSHA256,
		string(AgentInvocationReceiptStateStarted), receipt.CreatedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	stored, err := s.getAgentInvocationReceipt(ctx, receipt.InvocationID)
	if err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	if stored.RequestID != receipt.RequestID || stored.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if tag.RowsAffected() == 1 {
		return stored, AgentInvocationDispositionClaimed, nil
	}
	if stored.State == AgentInvocationReceiptStateCompleted {
		return stored, AgentInvocationDispositionReplay, nil
	}
	return stored, AgentInvocationDispositionAmbiguous, nil
}

func (s *PostgresRunProjectionStore) GetAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (AgentInvocationReceipt, error) {
	receipt, err := s.getAgentInvocationReceipt(ctx, strings.TrimSpace(invocationID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AgentInvocationReceipt{}, fmt.Errorf(
				"%w: invocation_id=%s",
				ErrAgentInvocationNotFound,
				strings.TrimSpace(invocationID),
			)
		}
		return AgentInvocationReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresRunProjectionStore) CompleteAgentInvocation(
	ctx context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, error) {
	if err := validateAgentInvocationReceipt(receipt, true); err != nil {
		return AgentInvocationReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stored, err := scanAgentInvocationReceipt(tx.QueryRow(ctx, `select invocation_id, request_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from execution_control.agent_invocation_receipts where invocation_id = $1 for update`, receipt.InvocationID))
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	if stored.RequestID != receipt.RequestID || stored.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if stored.State == AgentInvocationReceiptStateCompleted {
		if stored.OutputSHA256 != receipt.OutputSHA256 {
			return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", ErrAgentInvocationConflict)
		}
		return stored, nil
	}
	_, err = tx.Exec(ctx, `update execution_control.agent_invocation_receipts
	set state = $2, output_json = $3::jsonb, output_sha256 = $4,
		completed_at = $5, updated_at = $6 where invocation_id = $1`,
		receipt.InvocationID, string(AgentInvocationReceiptStateCompleted), receipt.OutputJSON,
		receipt.OutputSHA256, receipt.CompletedAt, receipt.UpdatedAt,
	)
	if err != nil {
		return AgentInvocationReceipt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AgentInvocationReceipt{}, err
	}
	receipt.State = AgentInvocationReceiptStateCompleted
	receipt.CreatedAt = stored.CreatedAt
	return receipt, nil
}

func (s *PostgresRunProjectionStore) getAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (AgentInvocationReceipt, error) {
	return scanAgentInvocationReceipt(s.pool.QueryRow(ctx, `select invocation_id, request_id,
		input_sha256, state, output_json, output_sha256, created_at, completed_at, updated_at
		from execution_control.agent_invocation_receipts where invocation_id = $1`, invocationID))
}

func scanAgentInvocationReceipt(row pgx.Row) (AgentInvocationReceipt, error) {
	var receipt AgentInvocationReceipt
	var state string
	var outputJSON []byte
	var completedAt *time.Time
	if err := row.Scan(&receipt.InvocationID, &receipt.RequestID, &receipt.InputSHA256, &state,
		&outputJSON, &receipt.OutputSHA256, &receipt.CreatedAt, &completedAt, &receipt.UpdatedAt); err != nil {
		return AgentInvocationReceipt{}, err
	}
	receipt.State = AgentInvocationReceiptState(state)
	receipt.OutputJSON = cloneRawMessage(outputJSON)
	if completedAt != nil {
		receipt.CompletedAt = *completedAt
	}
	return receipt, nil
}
