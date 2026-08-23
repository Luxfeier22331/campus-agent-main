package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) BeginOwnerDeletion(
	_ context.Context,
	ownerUserID string,
	now time.Time,
) (OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" || now.IsZero() {
		return OwnerDeletionStatus{}, fmt.Errorf("owner deletion owner and timestamp are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ownerDeletionFences == nil {
		s.ownerDeletionFences = map[string]OwnerDeletionState{}
	}
	if s.ownerDeletionFences[ownerUserID] == OwnerDeletionStateDeleted {
		return s.ownerDeletionStatusLocked(ownerUserID), nil
	}
	s.ownerDeletionFences[ownerUserID] = OwnerDeletionStateDraining
	for runID, run := range s.runs {
		if run.OwnerUserID != ownerUserID || !durableRunStatusIsActive(run.Status) {
			continue
		}
		if _, exists := s.cancellationCommands[runID]; exists {
			// Reuse the existing cancellation command, but still fence a
			// leased workflow start against the deletion owner fence.
			s.supersedeWorkflowStartIntentLocked(runID, now)
			continue
		}
		run.UpdatedAt = now
		event := DurableRunEvent{
			EventID:              run.RunID + ":run-cancel-requested",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunCancelRequested,
			OccurredAt:           now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": "cancel_requested", "reason": "account_deletion"},
		}
		if err := s.appendRunEventLocked(run, event); err != nil {
			return OwnerDeletionStatus{}, err
		}
		s.runs[runID] = cloneDurableRun(run)
		s.supersedeWorkflowStartIntentLocked(runID, now)
		s.cancellationCommands[runID] = RunCancellationCommand{
			RunID:         runID,
			WorkflowID:    "campus-agent.chat." + runID,
			Reason:        "account_deletion",
			State:         LifecycleIntentStatePending,
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
) (OwnerDeletionStatus, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	if ownerUserID == "" {
		return OwnerDeletionStatus{}, errors.New("owner deletion owner is required")
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.ownerDeletionFences[ownerUserID]; !exists {
		return OwnerDeletionStatus{}, ErrOwnerDeletionNotStarted
	}
	return s.ownerDeletionStatusLocked(ownerUserID), nil
}

func (s *InMemoryRunProjectionStore) FinalizeOwnerDeletion(
	_ context.Context,
	request OwnerDeletionFinalizeRequest,
) (OwnerDeletionStatus, error) {
	ownerUserID := strings.TrimSpace(request.OwnerUserID)
	if ownerUserID == "" || request.Now.IsZero() {
		return OwnerDeletionStatus{}, errors.New("owner deletion owner and timestamp are required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state, exists := s.ownerDeletionFences[ownerUserID]
	if !exists {
		return OwnerDeletionStatus{}, ErrOwnerDeletionNotStarted
	}
	if state == OwnerDeletionStateDeleted {
		return s.ownerDeletionStatusLocked(ownerUserID), nil
	}
	status := s.ownerDeletionStatusLocked(ownerUserID)
	if status.ActiveRuns > 0 {
		return status, ErrOwnerDeletionNotDrained
	}
	for runID, run := range s.runs {
		if run.OwnerUserID != ownerUserID {
			continue
		}
		s.deleteRunLocked(runID, run)
	}
	s.ownerDeletionFences[ownerUserID] = OwnerDeletionStateDeleted
	return s.ownerDeletionStatusLocked(ownerUserID), nil
}

func (s *InMemoryRunProjectionStore) ownerDeletionStatusLocked(ownerUserID string) OwnerDeletionStatus {
	status := OwnerDeletionStatus{
		OwnerUserID: ownerUserID,
		State:       s.ownerDeletionFences[ownerUserID],
	}
	for _, run := range s.runs {
		if run.OwnerUserID == ownerUserID && durableRunStatusIsActive(run.Status) {
			status.ActiveRuns++
		}
	}
	return status
}

func (s *InMemoryRunProjectionStore) deleteRunLocked(runID string, run DurableRun) {
	delete(s.runs, runID)
	delete(s.runEvents, runID)
	delete(s.workflowStartIntents, runID)
	delete(s.cancellationCommands, runID)
	delete(s.activeRunByConversation, run.ConversationID)
	for key, projection := range s.runSteps {
		if projection.RunID == runID {
			delete(s.runSteps, key)
		}
	}
	for key, projection := range s.stepAttempts {
		if projection.RunID == runID {
			delete(s.stepAttempts, key)
		}
	}
	for key, projection := range s.stepResults {
		if projection.RunID == runID {
			delete(s.stepResults, key)
		}
	}
	for invocationID, receipt := range s.agentInvocationReceipts {
		if receipt.RunID == runID {
			delete(s.agentInvocationReceipts, invocationID)
		}
	}
	for waiter := range s.runEventWaiters[runID] {
		close(waiter)
	}
	delete(s.runEventWaiters, runID)
}
