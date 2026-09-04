package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) BeginOwnerDeletion(
	_ context.Context,
	ownerUserID string,
	now time.Time,
) (execution.OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" || now.IsZero() {
		return execution.OwnerDeletionStatus{}, fmt.Errorf("owner deletion owner and timestamp are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ownerDeletionFences == nil {
		s.ownerDeletionFences = map[string]execution.OwnerDeletionState{}
	}
	if s.ownerDeletionFences[ownerUserID] == execution.OwnerDeletionStateDeleted {
		return s.ownerDeletionStatusLocked(ownerUserID), nil
	}
	s.ownerDeletionFences[ownerUserID] = execution.OwnerDeletionStateDraining
	for requestID, run := range s.runs {
		if run.OwnerUserID != ownerUserID || !execution.DurableRunStatusIsActive(run.Status) {
			continue
		}
		if _, exists := s.cancellationCommands[requestID]; exists {
			// Reuse the existing cancellation command, but still fence a
			// leased workflow start against the deletion owner fence.
			s.supersedeWorkflowStartIntentLocked(requestID, now)
			continue
		}
		run.UpdatedAt = now
		event := execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-cancel-requested",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunCancelRequested,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": "cancel_requested", "reason": "account_deletion"},
		}
		if err := s.appendRunEventLocked(run, event); err != nil {
			return execution.OwnerDeletionStatus{}, err
		}
		s.runs[requestID] = execution.CloneDurableRun(run)
		s.supersedeWorkflowStartIntentLocked(requestID, now)
		s.cancellationCommands[requestID] = execution.RunCancellationCommand{
			RequestID:     requestID,
			WorkflowID:    "campus-agent.chat." + requestID,
			Reason:        "account_deletion",
			State:         execution.LifecycleIntentStatePending,
			NextAttemptAt: now,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
	}
	return s.ownerDeletionStatusLocked(ownerUserID), nil
}

func (s *InMemoryRunProjectionStore) OwnerDeletionStatus(
	_ context.Context,
	ownerUserID string,
) (execution.OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" {
		return execution.OwnerDeletionStatus{}, errors.New("owner deletion owner is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.ownerDeletionFences[ownerUserID]; !exists {
		return execution.OwnerDeletionStatus{}, execution.ErrOwnerDeletionNotStarted
	}
	return s.ownerDeletionStatusLocked(ownerUserID), nil
}

func (s *InMemoryRunProjectionStore) FinalizeOwnerDeletion(
	_ context.Context,
	request execution.OwnerDeletionFinalizeRequest,
) (execution.OwnerDeletionStatus, error) {
	ownerUserID := strings.TrimSpace(request.OwnerUserID)
	if ownerUserID == "" || request.Now.IsZero() {
		return execution.OwnerDeletionStatus{}, errors.New("owner deletion owner and timestamp are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.ownerDeletionFences[ownerUserID]
	if !exists {
		return execution.OwnerDeletionStatus{}, execution.ErrOwnerDeletionNotStarted
	}
	if state == execution.OwnerDeletionStateDeleted {
		return s.ownerDeletionStatusLocked(ownerUserID), nil
	}
	status := s.ownerDeletionStatusLocked(ownerUserID)
	if status.ActiveRuns > 0 {
		return status, execution.ErrOwnerDeletionNotDrained
	}
	for requestID, run := range s.runs {
		if run.OwnerUserID != ownerUserID {
			continue
		}
		s.deleteRunLocked(requestID, run)
	}
	s.ownerDeletionFences[ownerUserID] = execution.OwnerDeletionStateDeleted
	return s.ownerDeletionStatusLocked(ownerUserID), nil
}

func (s *InMemoryRunProjectionStore) ownerDeletionStatusLocked(ownerUserID string) execution.OwnerDeletionStatus {
	status := execution.OwnerDeletionStatus{
		OwnerUserID: ownerUserID,
		State:       s.ownerDeletionFences[ownerUserID],
	}
	for _, run := range s.runs {
		if run.OwnerUserID == ownerUserID && execution.DurableRunStatusIsActive(run.Status) {
			status.ActiveRuns++
		}
	}
	return status
}

func (s *InMemoryRunProjectionStore) deleteRunLocked(requestID string, run execution.DurableRun) {
	delete(s.runs, requestID)
	delete(s.runEvents, requestID)
	delete(s.workflowStartIntents, requestID)
	delete(s.cancellationCommands, requestID)
	delete(s.activeRunByConversation, run.ConversationID)
	for key, projection := range s.runSteps {
		if projection.RequestID == requestID {
			delete(s.runSteps, key)
		}
	}
	for key, projection := range s.stepAttempts {
		if projection.RequestID == requestID {
			delete(s.stepAttempts, key)
		}
	}
	for key, projection := range s.stepResults {
		if projection.RequestID == requestID {
			delete(s.stepResults, key)
		}
	}
	for invocationID, receipt := range s.agentInvocationReceipts {
		if receipt.RequestID == requestID {
			delete(s.agentInvocationReceipts, invocationID)
		}
	}
	for waiter := range s.runEventWaiters[requestID] {
		close(waiter)
	}
	delete(s.runEventWaiters, requestID)
}
