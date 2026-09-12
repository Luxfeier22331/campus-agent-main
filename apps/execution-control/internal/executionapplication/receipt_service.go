package executionapplication

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// ReceiptService owns invocation identity, terminal state and the complete output.
// A started receipt with no terminal result is ambiguous and must not call the provider again.
type ReceiptService struct{ store ReceiptStore }

func NewReceiptService(store ReceiptStore) *ReceiptService { return &ReceiptService{store: store} }

func (s *ReceiptService) Begin(ctx context.Context, invocationID, requestID, inputSHA256 string) (execution.AgentInvocationReceipt, execution.AgentInvocationDisposition, error) {
	if s == nil || s.store == nil {
		return execution.AgentInvocationReceipt{}, "", errors.New("receipt store is not configured")
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	receipt, disposition, err := s.store.BeginAgentInvocation(ctx, execution.AgentInvocationReceipt{InvocationID: invocationID, RequestID: requestID, InputSHA256: inputSHA256, CreatedAt: now, UpdatedAt: now})
	return receipt, disposition, err
}

func (s *ReceiptService) Complete(ctx context.Context, receipt execution.AgentInvocationReceipt, output any) error {
	return s.finish(ctx, receipt, output, execution.AgentInvocationReceiptStateCompleted)
}

func (s *ReceiptService) CompleteFailed(ctx context.Context, receipt execution.AgentInvocationReceipt, output any) error {
	return s.finish(ctx, receipt, output, execution.AgentInvocationReceiptStateFailed)
}

func (s *ReceiptService) Fail(ctx context.Context, receipt execution.AgentInvocationReceipt, code string) error {
	return s.finish(ctx, receipt, map[string]any{"status": "failed", "failure": map[string]string{"code": code}}, execution.AgentInvocationReceiptStateFailed)
}

func (s *ReceiptService) finish(ctx context.Context, receipt execution.AgentInvocationReceipt, output any, state execution.AgentInvocationReceiptState) error {
	encoded, err := json.Marshal(output)
	if err != nil {
		return err
	}
	if err := execution.ValidateOperationPayloadBytes(encoded); err != nil {
		return err
	}
	hash := sha256.Sum256(encoded)
	receipt.OutputJSON = encoded
	receipt.OutputSHA256 = hex.EncodeToString(hash[:])
	receipt.State = state
	receipt.CompletedAt = time.Now().UTC().Truncate(time.Microsecond)
	receipt.UpdatedAt = receipt.CompletedAt
	_, err = s.store.CompleteAgentInvocation(ctx, receipt)
	return err
}
