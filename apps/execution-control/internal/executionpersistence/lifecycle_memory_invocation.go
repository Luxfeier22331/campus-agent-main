package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
)

func (s *InMemoryRunProjectionStore) BeginAgentInvocation(
	_ context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, execution.AgentInvocationDisposition, error) {
	if err := execution.ValidateAgentInvocationReceipt(receipt, false); err != nil {
		return execution.AgentInvocationReceipt{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[receipt.RequestID]; !exists {
		return execution.AgentInvocationReceipt{}, "", fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, receipt.RequestID)
	}
	existing, exists := s.agentInvocationReceipts[receipt.InvocationID]
	if !exists {
		receipt.State = execution.AgentInvocationReceiptStateStarted
		receipt.OutputJSON = nil
		receipt.OutputSHA256 = ""
		s.agentInvocationReceipts[receipt.InvocationID] = execution.CloneAgentInvocationReceipt(receipt)
		return execution.CloneAgentInvocationReceipt(receipt), execution.AgentInvocationDispositionClaimed, nil
	}
	if existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if existing.State == execution.AgentInvocationReceiptStateCompleted {
		return execution.CloneAgentInvocationReceipt(existing), execution.AgentInvocationDispositionReplay, nil
	}
	return execution.CloneAgentInvocationReceipt(existing), execution.AgentInvocationDispositionAmbiguous, nil
}

func (s *InMemoryRunProjectionStore) GetAgentInvocationReceipt(
	_ context.Context,
	invocationID string,
) (execution.AgentInvocationReceipt, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	receipt, exists := s.agentInvocationReceipts[strings.TrimSpace(invocationID)]
	if !exists {
		return execution.AgentInvocationReceipt{}, fmt.Errorf(
			"%w: invocation_id=%s",
			execution.ErrAgentInvocationNotFound,
			strings.TrimSpace(invocationID),
		)
	}
	return execution.CloneAgentInvocationReceipt(receipt), nil
}

func (s *InMemoryRunProjectionStore) CompleteAgentInvocation(
	_ context.Context,
	receipt execution.AgentInvocationReceipt,
) (execution.AgentInvocationReceipt, error) {
	if err := execution.ValidateAgentInvocationReceipt(receipt, true); err != nil {
		return execution.AgentInvocationReceipt{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, exists := s.agentInvocationReceipts[receipt.InvocationID]
	if !exists || existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", execution.ErrAgentInvocationConflict)
	}
	if existing.State == execution.AgentInvocationReceiptStateCompleted {
		if existing.OutputSHA256 != receipt.OutputSHA256 {
			return execution.AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", execution.ErrAgentInvocationConflict)
		}
		return execution.CloneAgentInvocationReceipt(existing), nil
	}
	receipt.State = execution.AgentInvocationReceiptStateCompleted
	receipt.CreatedAt = existing.CreatedAt
	s.agentInvocationReceipts[receipt.InvocationID] = execution.CloneAgentInvocationReceipt(receipt)
	return execution.CloneAgentInvocationReceipt(receipt), nil
}
