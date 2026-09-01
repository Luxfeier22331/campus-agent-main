package execution

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) LeaseWorkflowStartIntents(
	_ context.Context,
	request LifecycleLeaseRequest,
) ([]WorkflowStartIntent, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.workflowStartIntents))
	for key := range s.workflowStartIntents {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	leased := make([]WorkflowStartIntent, 0, request.Limit)
	for _, key := range keys {
		intent := s.workflowStartIntents[key]
		run, runExists := s.runs[intent.RequestID]
		if !runExists {
			continue
		}
		if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested && !durableRunStatusIsTerminal(run.Status) {
			continue
		}
		if !lifecycleIntentLeaseable(intent.State, intent.NextAttemptAt, intent.LeaseUntil, request.Now) {
			continue
		}
		intent.State = LifecycleIntentStateLeased
		intent.LeaseToken = request.LeaseToken
		intent.LeaseUntil = request.LeaseUntil
		intent.AttemptCount++
		intent.UpdatedAt = request.Now
		s.workflowStartIntents[key] = cloneWorkflowStartIntent(intent)
		leased = append(leased, cloneWorkflowStartIntent(intent))
		if len(leased) == request.Limit {
			break
		}
	}
	return leased, nil
}

// GetWorkflowStartIntent returns a cloned intent so a reconciler can fence a
// stale leased snapshot before performing an external Temporal call.
func (s *InMemoryRunProjectionStore) GetWorkflowStartIntent(
	_ context.Context,
	requestID string,
) (WorkflowStartIntent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	intent, exists := s.workflowStartIntents[strings.TrimSpace(requestID)]
	if !exists {
		return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, requestID)
	}
	return cloneWorkflowStartIntent(intent), nil
}

func (s *InMemoryRunProjectionStore) MarkWorkflowStartDispatchAttempt(
	_ context.Context,
	result WorkflowStartIntentResult,
) error {
	result.RequestID = strings.TrimSpace(result.RequestID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RequestID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start dispatch fence", ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := leasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	run, exists := s.runs[intent.RequestID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, intent.RequestID)
	}
	if !durableRunStatusIsActive(run.Status) {
		return fmt.Errorf("%w: workflow start request_id=%s is not active", ErrLifecycleLeaseConflict, intent.RequestID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested {
		return fmt.Errorf("%w: workflow start request_id=%s was canceled", ErrLifecycleLeaseConflict, intent.RequestID)
	}
	intent.DispatchAttempted = true
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = cloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) BindSupersededWorkflowStartExecution(
	_ context.Context,
	binding WorkflowStartExecutionBinding,
) (WorkflowStartIntent, error) {
	binding = canonicalWorkflowStartExecutionBinding(binding)
	if err := validateWorkflowStartExecutionBinding(binding); err != nil {
		return WorkflowStartIntent{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[binding.RequestID]; !exists {
		return WorkflowStartIntent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, binding.RequestID)
	}
	intent, exists := s.workflowStartIntents[binding.RequestID]
	if !exists || intent.RequestID != binding.RequestID || intent.WorkflowID != binding.WorkflowID ||
		intent.State != LifecycleIntentStateSuperseded || !intent.DispatchAttempted {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start request_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	command, exists := s.cancellationCommands[binding.RequestID]
	if !exists || command.RequestID != binding.RequestID || command.WorkflowID != binding.WorkflowID {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: cancellation identity request_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	existingRunID := strings.TrimSpace(intent.TemporalRunID)
	if existingRunID != "" {
		if existingRunID != binding.TemporalRunID {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: temporal run id differs for request_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RequestID,
			)
		}
		return cloneWorkflowStartIntent(intent), nil
	}
	intent.TemporalRunID = binding.TemporalRunID
	intent.UpdatedAt = binding.Now
	s.workflowStartIntents[binding.RequestID] = cloneWorkflowStartIntent(intent)
	return cloneWorkflowStartIntent(intent), nil
}

func canonicalWorkflowStartExecutionBinding(binding WorkflowStartExecutionBinding) WorkflowStartExecutionBinding {
	binding.RequestID = strings.TrimSpace(binding.RequestID)
	binding.WorkflowID = strings.TrimSpace(binding.WorkflowID)
	binding.TemporalRunID = strings.TrimSpace(binding.TemporalRunID)
	return binding
}

func validateWorkflowStartExecutionBinding(binding WorkflowStartExecutionBinding) error {
	if binding.RequestID == "" || binding.WorkflowID == "" || binding.TemporalRunID == "" || binding.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start execution binding", ErrWorkflowStartExecutionBindingConflict)
	}
	return nil
}

func (s *InMemoryRunProjectionStore) ListActiveWorkflowRuns(
	_ context.Context,
	afterRunID string,
	limit int,
) ([]ActiveWorkflowRun, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("%w: active workflow limit must be positive", ErrInvalidDurableRun)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	keys := make([]string, 0, len(s.workflowStartIntents))
	for requestID := range s.workflowStartIntents {
		keys = append(keys, requestID)
	}
	sort.Strings(keys)
	result := make([]ActiveWorkflowRun, 0, limit)
	for _, requestID := range keys {
		if requestID <= strings.TrimSpace(afterRunID) {
			continue
		}
		intent := s.workflowStartIntents[requestID]
		run, exists := s.runs[requestID]
		if !exists || intent.State != LifecycleIntentStateConfirmed || !durableRunStatusIsActive(run.Status) {
			continue
		}
		if command, cancellationRequested := s.cancellationCommands[requestID]; cancellationRequested && command.State != LifecycleIntentStateConfirmed {
			continue
		}
		result = append(result, ActiveWorkflowRun{Run: cloneDurableRun(run), StartIntent: cloneWorkflowStartIntent(intent)})
		if len(result) == limit {
			break
		}
	}
	return result, nil
}

func (s *InMemoryRunProjectionStore) ConfirmWorkflowStartIntent(
	_ context.Context,
	result WorkflowStartIntentResult,
) error {
	if strings.TrimSpace(result.TemporalRunID) == "" {
		return fmt.Errorf("%w: confirmed temporal run id is required", ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, exists := s.workflowStartIntents[result.RequestID]
	if !exists {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	if intent.State == LifecycleIntentStateConfirmed {
		if !intent.DispatchAttempted {
			return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RequestID)
		}
		if strings.TrimSpace(result.TemporalRunID) != "" &&
			strings.TrimSpace(result.TemporalRunID) != intent.TemporalRunID {
			return fmt.Errorf("%w: confirmed temporal run id differs for request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
		}
		return nil
	}
	if intent.State == LifecycleIntentStateSuperseded {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	if intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	if !intent.DispatchAttempted {
		return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RequestID)
	}
	run, exists := s.runs[intent.RequestID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, intent.RequestID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested {
		intent.State = LifecycleIntentStateSuperseded
		intent.LeaseToken = ""
		intent.LeaseUntil = time.Time{}
		intent.UpdatedAt = result.Now
		s.workflowStartIntents[intent.RequestID] = cloneWorkflowStartIntent(intent)
		return fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, intent.RequestID)
	}

	// Keep the run transition, its lifecycle events, and the intent update in
	// one critical section. A cancellation request takes this same lock and
	// therefore cannot leave a stale start lease able to win afterwards.
	originalRun := cloneDurableRun(run)
	originalEvents := append([]DurableRunEvent(nil), s.runEvents[intent.RequestID]...)
	rollback := func() {
		s.runs[intent.RequestID] = originalRun
		s.runEvents[intent.RequestID] = originalEvents
	}
	if run.Status == DurableRunStatusCreated {
		queuedAt := result.Now
		run.Status = DurableRunStatusQueued
		run.TerminalReason = ""
		run.UpdatedAt = queuedAt
		recordDurableRunStatusTimestamp(&run, DurableRunStatusQueued, queuedAt)
		if err := validateDurableRun(run); err != nil {
			return err
		}
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              run.RequestID + ":workflow-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeWorkflowStarted,
			OccurredAt:           result.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusCreated),
				"workflow_id":     intent.WorkflowID,
				"temporal_run_id": strings.TrimSpace(result.TemporalRunID),
				"task_queue":      intent.TaskQueue,
			},
		}); err != nil {
			rollback()
			return err
		}
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              run.RequestID + ":run-queued",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunQueued,
			OccurredAt:           queuedAt,
			Visibility:           DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(DurableRunStatusQueued)},
		}); err != nil {
			rollback()
			return err
		}
		s.runs[intent.RequestID] = cloneDurableRun(run)
	}
	intent.State = LifecycleIntentStateConfirmed
	intent.TemporalRunID = strings.TrimSpace(result.TemporalRunID)
	intent.LastErrorCode = ""
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = cloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) RetryWorkflowStartIntent(
	_ context.Context,
	result WorkflowStartIntentResult,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := leasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	intent.State = LifecycleIntentStatePending
	intent.NextAttemptAt = result.NextAttemptAt
	intent.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = cloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) FailWorkflowStartIntent(
	_ context.Context,
	result WorkflowStartIntentResult,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := leasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	intent.State = LifecycleIntentStatePermanentFailed
	intent.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = cloneWorkflowStartIntent(intent)
	return nil
}
