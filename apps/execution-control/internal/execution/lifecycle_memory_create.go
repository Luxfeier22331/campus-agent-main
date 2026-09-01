package execution

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (s *InMemoryRunProjectionStore) CreateRunWithStartIntent(
	_ context.Context,
	request DurableRunCreateIntent,
) (DurableRunCreateResult, error) {
	run := request.Run
	if run.Status == "" {
		run.Status = DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	run.RequestFingerprintSHA256 = strings.TrimSpace(request.RequestFingerprintSHA256)
	if err := validateDurableRunCreateIntent(run, request); err != nil {
		return DurableRunCreateResult{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, exists := s.runs[run.RequestID]; exists {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return DurableRunCreateResult{Run: cloneDurableRun(existing)}, nil
		}
		return DurableRunCreateResult{}, fmt.Errorf(
			"%w: request_id=%s",
			ErrDurableRunFingerprintConflict,
			run.RequestID,
		)
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == OwnerDeletionStateDeleted {
		return DurableRunCreateResult{}, ErrOwnerDeleted
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == OwnerDeletionStateDraining {
		return DurableRunCreateResult{}, ErrOwnerDeletionNotDrained
	}
	if existingRunID, exists := s.activeRunByConversation[run.ConversationID]; exists {
		return DurableRunCreateResult{}, fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	event := cloneDurableRunEvent(request.CreatedEvent)
	event.Sequence = 1
	intent := WorkflowStartIntent{
		RequestID:         run.RequestID,
		WorkflowID:        strings.TrimSpace(request.WorkflowID),
		PayloadSHA256:     strings.TrimSpace(request.PayloadSHA256),
		TaskQueue:         strings.TrimSpace(request.TaskQueue),
		WorkflowInputJSON: cloneRawMessage(request.WorkflowInputJSON),
		State:             LifecycleIntentStatePending,
		NextAttemptAt:     run.CreatedAt,
		CreatedAt:         run.CreatedAt,
		UpdatedAt:         run.CreatedAt,
	}
	s.runs[run.RequestID] = cloneDurableRun(run)
	s.runEvents[run.RequestID] = []DurableRunEvent{event}
	s.workflowStartIntents[run.RequestID] = cloneWorkflowStartIntent(intent)
	s.activeRunByConversation[run.ConversationID] = run.RequestID
	return DurableRunCreateResult{Run: cloneDurableRun(run), Created: true}, nil
}

func validateDurableRunCreateIntent(run DurableRun, request DurableRunCreateIntent) error {
	if err := validateDurableRun(run); err != nil {
		return err
	}
	if run.Status != DurableRunStatusCreated {
		return fmt.Errorf("%w: atomic create status must be created", ErrInvalidDurableRun)
	}
	if !validLowerHexSHA256(request.RequestFingerprintSHA256) ||
		!validLowerHexSHA256(request.PayloadSHA256) {
		return fmt.Errorf("%w: request and payload fingerprints must be lowercase SHA-256", ErrInvalidDurableRun)
	}
	if strings.TrimSpace(request.WorkflowID) == "" || strings.TrimSpace(request.TaskQueue) == "" {
		return fmt.Errorf("%w: workflow_id and task_queue are required", ErrInvalidDurableRun)
	}
	if !json.Valid(request.WorkflowInputJSON) {
		return fmt.Errorf("%w: workflow input must be valid JSON", ErrInvalidDurableRun)
	}
	event := request.CreatedEvent
	if event.Sequence != 0 && event.Sequence != 1 {
		return fmt.Errorf("%w: run.created sequence must be store-assigned", ErrInvalidRunEvent)
	}
	event.Sequence = 1
	if event.RequestID != run.RequestID || event.ConversationID != run.ConversationID ||
		event.EventType != DurableRunEventTypeRunCreated {
		return fmt.Errorf("%w: run.created identity is invalid", ErrInvalidRunEvent)
	}
	return validateDurableRunEventBase(event)
}
