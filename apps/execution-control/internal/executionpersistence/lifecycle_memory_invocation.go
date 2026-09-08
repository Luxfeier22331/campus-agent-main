package executionpersistence

import (
	"context"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *InMemoryReceiptStore) BeginAgentInvocation(
	_ context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, execution.AgentInvocationDisposition, error) {
	if err := execution.ValidateAgentInvocationReceipt(receipt, false); err != nil {
		return execution.AgentInvocationReceipt{}, "", err
	}
	s.data.mu.Lock()
	defer s.data.mu.Unlock()
	if _, exists := s.data.runs[receipt.RequestID]; !exists {
		return execution.AgentInvocationReceipt{}, "", fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, receipt.RequestID)
	}
	existing, exists := s.records[receipt.InvocationID]
	if !exists {
		receipt.State = execution.AgentInvocationReceiptStateStarted
		receipt.OutputJSON = nil
		receipt.OutputSHA256 = ""
		s.records[receipt.InvocationID] = execution.CloneAgentInvocationReceipt(receipt)
		return execution.CloneAgentInvocationReceipt(receipt), execution.AgentInvocationDispositionClaimed, nil
	}
	if existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if existing.State == execution.AgentInvocationReceiptStateCompleted || existing.State == execution.AgentInvocationReceiptStateFailed {
		return execution.CloneAgentInvocationReceipt(existing), execution.AgentInvocationDispositionReplay, nil
	}
	return execution.CloneAgentInvocationReceipt(existing), execution.AgentInvocationDispositionAmbiguous, nil
}

func (s *InMemoryReceiptStore) GetAgentInvocationReceipt(
	_ context.Context,
	invocationID string,
) (execution.AgentInvocationReceipt, error) {
	s.data.mu.RLock()
	defer s.data.mu.RUnlock()
	receipt, exists := s.records[strings.TrimSpace(invocationID)]
	if !exists {
		return execution.AgentInvocationReceipt{}, fmt.Errorf(
			"%w: invocation_id=%s",
			execution.ErrAgentInvocationNotFound,
			strings.TrimSpace(invocationID),
		)
	}
	return execution.CloneAgentInvocationReceipt(receipt), nil
}

func (s *InMemoryReceiptStore) CompleteAgentInvocation(
	_ context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, error) {
	if receipt.State == "" {
		receipt.State = execution.AgentInvocationReceiptStateCompleted
	}
	if err := execution.ValidateAgentInvocationReceipt(receipt, true); err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	s.data.mu.Lock()
	defer s.data.mu.Unlock()
	existing, exists := s.records[receipt.InvocationID]
	if !exists || existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if existing.State == execution.AgentInvocationReceiptStateCompleted || existing.State == execution.AgentInvocationReceiptStateFailed {
		if existing.OutputSHA256 != receipt.OutputSHA256 || existing.State != receipt.State {
			return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", execution.ErrAgentInvocationConflict)
		}
		return execution.CloneAgentInvocationReceipt(existing), nil
	}
	if receipt.State != execution.AgentInvocationReceiptStateFailed {
		receipt.State = execution.AgentInvocationReceiptStateCompleted
	}
	receipt.CreatedAt = existing.CreatedAt
	s.records[receipt.InvocationID] = execution.CloneAgentInvocationReceipt(receipt)
	return execution.CloneAgentInvocationReceipt(receipt), nil
}
