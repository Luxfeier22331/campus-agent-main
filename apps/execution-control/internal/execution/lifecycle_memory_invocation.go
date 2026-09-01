package execution

import (
	"context"
	"fmt"
	"strings"
)

func (s *InMemoryRunProjectionStore) BeginAgentInvocation(
	_ context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, AgentInvocationDisposition, error) {
	if err := validateAgentInvocationReceipt(receipt, false); err != nil {
		return AgentInvocationReceipt{}, "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[receipt.RequestID]; !exists {
		return AgentInvocationReceipt{}, "", fmt.Errorf("%w: %s", ErrDurableRunNotFound, receipt.RequestID)
	}
	existing, exists := s.agentInvocationReceipts[receipt.InvocationID]
	if !exists {
		receipt.State = AgentInvocationReceiptStateStarted
		receipt.OutputJSON = nil
		receipt.OutputSHA256 = ""
		s.agentInvocationReceipts[receipt.InvocationID] = cloneAgentInvocationReceipt(receipt)
		return cloneAgentInvocationReceipt(receipt), AgentInvocationDispositionClaimed, nil
	}
	if existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, "", fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if existing.State == AgentInvocationReceiptStateCompleted {
		return cloneAgentInvocationReceipt(existing), AgentInvocationDispositionReplay, nil
	}
	return cloneAgentInvocationReceipt(existing), AgentInvocationDispositionAmbiguous, nil
}

func (s *InMemoryRunProjectionStore) GetAgentInvocationReceipt(
	_ context.Context,
	invocationID string,
) (AgentInvocationReceipt, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	receipt, exists := s.agentInvocationReceipts[strings.TrimSpace(invocationID)]
	if !exists {
		return AgentInvocationReceipt{}, fmt.Errorf(
			"%w: invocation_id=%s",
			ErrAgentInvocationNotFound,
			strings.TrimSpace(invocationID),
		)
	}
	return cloneAgentInvocationReceipt(receipt), nil
}

func (s *InMemoryRunProjectionStore) CompleteAgentInvocation(
	_ context.Context,
	receipt AgentInvocationReceipt,
) (AgentInvocationReceipt, error) {
	if err := validateAgentInvocationReceipt(receipt, true); err != nil {
		return AgentInvocationReceipt{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, exists := s.agentInvocationReceipts[receipt.InvocationID]
	if !exists || existing.RequestID != receipt.RequestID || existing.InputSHA256 != receipt.InputSHA256 {
		return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation identity differs", ErrAgentInvocationConflict)
	}
	if existing.State == AgentInvocationReceiptStateCompleted {
		if existing.OutputSHA256 != receipt.OutputSHA256 {
			return AgentInvocationReceipt{}, fmt.Errorf("%w: invocation output differs", ErrAgentInvocationConflict)
		}
		return cloneAgentInvocationReceipt(existing), nil
	}
	receipt.State = AgentInvocationReceiptStateCompleted
	receipt.CreatedAt = existing.CreatedAt
	s.agentInvocationReceipts[receipt.InvocationID] = cloneAgentInvocationReceipt(receipt)
	return cloneAgentInvocationReceipt(receipt), nil
}
