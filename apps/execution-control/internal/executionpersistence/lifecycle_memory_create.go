package executionpersistence

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
)

func (s *InMemoryRunProjectionStore) CreateRunWithStartIntent(
	_ context.Context,
	request execution.DurableRunCreateIntent,
) (execution.DurableRunCreateResult, error) {
	run := request.Run
	if run.Status == "" {
		run.Status = execution.DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	run.RequestFingerprintSHA256 = strings.TrimSpace(request.RequestFingerprintSHA256)
	if err := validateDurableRunCreateIntent(run, request); err != nil {
		return execution.DurableRunCreateResult{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, exists := s.runs[run.RequestID]; exists {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return execution.DurableRunCreateResult{Run: execution.CloneDurableRun(existing)}, nil
		}
		return execution.DurableRunCreateResult{}, fmt.Errorf(
			"%w: request_id=%s",
			execution.ErrDurableRunFingerprintConflict,
			run.RequestID,
		)
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == execution.OwnerDeletionStateDeleted {
		return execution.DurableRunCreateResult{}, execution.ErrOwnerDeleted
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == execution.OwnerDeletionStateDraining {
		return execution.DurableRunCreateResult{}, execution.ErrOwnerDeletionNotDrained
	}
	if existingRunID, exists := s.activeRunByConversation[run.ConversationID]; exists {
		return execution.DurableRunCreateResult{}, fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			execution.ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	event := execution.CloneDurableRunEvent(request.CreatedEvent)
	event.Sequence = 1
	intent := execution.WorkflowStartIntent{
		RequestID:         run.RequestID,
		WorkflowID:        strings.TrimSpace(request.WorkflowID),
		PayloadSHA256:     strings.TrimSpace(request.PayloadSHA256),
		TaskQueue:         strings.TrimSpace(request.TaskQueue),
		WorkflowInputJSON: cloneRawMessage(request.WorkflowInputJSON),
		State:             execution.LifecycleIntentStatePending,
		NextAttemptAt:     run.CreatedAt,
		CreatedAt:         run.CreatedAt,
		UpdatedAt:         run.CreatedAt,
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(run)
	s.runEvents[run.RequestID] = []execution.DurableRunEvent{event}
	s.workflowStartIntents[run.RequestID] = execution.CloneWorkflowStartIntent(intent)
	s.activeRunByConversation[run.ConversationID] = run.RequestID
	return execution.DurableRunCreateResult{Run: execution.CloneDurableRun(run), Created: true}, nil
}

func validateDurableRunCreateIntent(run execution.DurableRun, request execution.DurableRunCreateIntent) error {
	if err := execution.ValidateDurableRun(run); err != nil {
		return err
	}
	if run.Status != execution.DurableRunStatusCreated {
		return fmt.Errorf("%w: atomic create status must be created", execution.ErrInvalidDurableRun)
	}
	if !execution.ValidLowerHexSHA256(request.RequestFingerprintSHA256) ||
		!execution.ValidLowerHexSHA256(request.PayloadSHA256) {
		return fmt.Errorf("%w: request and payload fingerprints must be lowercase SHA-256", execution.ErrInvalidDurableRun)
	}
	if strings.TrimSpace(request.WorkflowID) == "" || strings.TrimSpace(request.TaskQueue) == "" {
		return fmt.Errorf("%w: workflow_id and task_queue are required", execution.ErrInvalidDurableRun)
	}
	if !json.Valid(request.WorkflowInputJSON) {
		return fmt.Errorf("%w: workflow input must be valid JSON", execution.ErrInvalidDurableRun)
	}
	event := request.CreatedEvent
	if event.Sequence != 0 && event.Sequence != 1 {
		return fmt.Errorf("%w: run.created sequence must be store-assigned", execution.ErrInvalidRunEvent)
	}
	event.Sequence = 1
	if event.RequestID != run.RequestID || event.ConversationID != run.ConversationID ||
		event.EventType != execution.DurableRunEventTypeRunCreated {
		return fmt.Errorf("%w: run.created identity is invalid", execution.ErrInvalidRunEvent)
	}
	return execution.ValidateDurableRunEventBase(event)
}
