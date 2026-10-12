package executionapplication

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type RuntimeInvocationRequest struct {
	RequestID    string
	InvocationID string
	InputSHA256  string
	Payload      json.RawMessage
}

// RuntimeInvocationService owns model-turn receipt claims and replay.
type RuntimeInvocationService struct {
	Receipts ReceiptStore
	Runs     interface {
		TemporalActivityRun(context.Context, string) (execution.DurableRun, error)
	}
}

func (s *RuntimeInvocationService) Get(ctx context.Context, in RuntimeInvocationRequest) (RuntimeInvocationResult, error) {
	receipt, err := s.Receipts.GetAgentInvocationReceipt(ctx, in.InvocationID)
	if errors.Is(err, execution.ErrAgentInvocationNotFound) {
		return RuntimeInvocationResult{Disposition: "new"}, nil
	}
	if err != nil {
		return RuntimeInvocationResult{}, err
	}
	if receipt.RequestID != in.RequestID || receipt.InputSHA256 != in.InputSHA256 {
		return RuntimeInvocationResult{}, execution.ErrAgentInvocationConflict
	}
	disposition := "ambiguous"
	if receipt.State == execution.AgentInvocationReceiptStateCompleted || receipt.State == execution.AgentInvocationReceiptStateFailed {
		disposition = "replay"
	}
	return RuntimeInvocationResult{Disposition: disposition, Output: receipt.OutputJSON}, nil
}
func (s *RuntimeInvocationService) Begin(ctx context.Context, in RuntimeInvocationRequest) (RuntimeInvocationResult, error) {
	if _, err := s.Runs.TemporalActivityRun(ctx, in.RequestID); err != nil {
		return RuntimeInvocationResult{}, err
	}
	receipt, disposition, err := NewReceiptService(s.Receipts).Begin(ctx, in.InvocationID, in.RequestID, in.InputSHA256)
	return RuntimeInvocationResult{Disposition: string(disposition), Output: receipt.OutputJSON}, err
}
func (s *RuntimeInvocationService) Complete(ctx context.Context, in RuntimeInvocationRequest) (RuntimeInvocationResult, error) {
	receipt, err := s.Receipts.GetAgentInvocationReceipt(ctx, in.InvocationID)
	if err != nil {
		return RuntimeInvocationResult{}, err
	}
	if receipt.RequestID != in.RequestID {
		return RuntimeInvocationResult{}, execution.ErrAgentInvocationConflict
	}
	return RuntimeInvocationResult{}, NewReceiptService(s.Receipts).Complete(ctx, receipt, in.Payload)
}
