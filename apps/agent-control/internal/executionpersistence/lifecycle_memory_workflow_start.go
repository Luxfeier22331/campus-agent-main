package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"sort"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) LeaseWorkflowStartIntents(
	_ context.Context,
	request execution.LifecycleLeaseRequest,
) ([]execution.WorkflowStartIntent, error) {
	if err := execution.ValidateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.workflowStartIntents))
	for key := range s.workflowStartIntents {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	leased := make([]execution.WorkflowStartIntent, 0, request.Limit)
	for _, key := range keys {
		intent := s.workflowStartIntents[key]
		run, runExists := s.runs[intent.RequestID]
		if !runExists {
			continue
		}
		if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested && !execution.DurableRunStatusIsTerminal(run.Status) {
			continue
		}
		if !execution.LifecycleIntentLeaseable(intent.State, intent.NextAttemptAt, intent.LeaseUntil, request.Now) {
			continue
		}
		intent.State = execution.LifecycleIntentStateLeased
		intent.LeaseToken = request.LeaseToken
		intent.LeaseUntil = request.LeaseUntil
		intent.AttemptCount++
		intent.UpdatedAt = request.Now
		s.workflowStartIntents[key] = execution.CloneWorkflowStartIntent(intent)
		leased = append(leased, execution.CloneWorkflowStartIntent(intent))
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
) (execution.WorkflowStartIntent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	intent, exists := s.workflowStartIntents[strings.TrimSpace(requestID)]
	if !exists {
		return execution.WorkflowStartIntent{}, fmt.Errorf("%w: workflow start request_id=%s", execution.ErrLifecycleLeaseConflict, requestID)
	}
	return execution.CloneWorkflowStartIntent(intent), nil
}

func (s *InMemoryRunProjectionStore) MarkWorkflowStartDispatchAttempt(
	_ context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	result.RequestID = strings.TrimSpace(result.RequestID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RequestID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start dispatch fence", execution.ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := execution.LeasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	run, exists := s.runs[intent.RequestID]
	if !exists {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, intent.RequestID)
	}
	if !execution.DurableRunStatusIsActive(run.Status) {
		return fmt.Errorf("%w: workflow start request_id=%s is not active", execution.ErrLifecycleLeaseConflict, intent.RequestID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested {
		return fmt.Errorf("%w: workflow start request_id=%s was canceled", execution.ErrLifecycleLeaseConflict, intent.RequestID)
	}
	intent.DispatchAttempted = true
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = execution.CloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) BindSupersededWorkflowStartExecution(
	_ context.Context,
	binding execution.WorkflowStartExecutionBinding,
) (execution.WorkflowStartIntent, error) {
	binding = canonicalWorkflowStartExecutionBinding(binding)
	if err := validateWorkflowStartExecutionBinding(binding); err != nil {
		return execution.WorkflowStartIntent{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[binding.RequestID]; !exists {
		return execution.WorkflowStartIntent{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, binding.RequestID)
	}
	intent, exists := s.workflowStartIntents[binding.RequestID]
	if !exists || intent.RequestID != binding.RequestID || intent.WorkflowID != binding.WorkflowID ||
		intent.State != execution.LifecycleIntentStateSuperseded || !intent.DispatchAttempted {
		return execution.WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start request_id=%s",
			execution.ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	command, exists := s.cancellationCommands[binding.RequestID]
	if !exists || command.RequestID != binding.RequestID || command.WorkflowID != binding.WorkflowID {
		return execution.WorkflowStartIntent{}, fmt.Errorf(
			"%w: cancellation identity request_id=%s",
			execution.ErrWorkflowStartExecutionBindingConflict,
			binding.RequestID,
		)
	}
	existingRunID := strings.TrimSpace(intent.TemporalRunID)
	if existingRunID != "" {
		if existingRunID != binding.TemporalRunID {
			return execution.WorkflowStartIntent{}, fmt.Errorf(
				"%w: temporal run id differs for request_id=%s",
				execution.ErrWorkflowStartExecutionBindingConflict,
				binding.RequestID,
			)
		}
		return execution.CloneWorkflowStartIntent(intent), nil
	}
	intent.TemporalRunID = binding.TemporalRunID
	intent.UpdatedAt = binding.Now
	s.workflowStartIntents[binding.RequestID] = execution.CloneWorkflowStartIntent(intent)
	return execution.CloneWorkflowStartIntent(intent), nil
}

func canonicalWorkflowStartExecutionBinding(binding execution.WorkflowStartExecutionBinding) execution.WorkflowStartExecutionBinding {
	binding.RequestID = strings.TrimSpace(binding.RequestID)
	binding.WorkflowID = strings.TrimSpace(binding.WorkflowID)
	binding.TemporalRunID = strings.TrimSpace(binding.TemporalRunID)
	return binding
}

func validateWorkflowStartExecutionBinding(binding execution.WorkflowStartExecutionBinding) error {
	if binding.RequestID == "" || binding.WorkflowID == "" || binding.TemporalRunID == "" || binding.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start execution binding", execution.ErrWorkflowStartExecutionBindingConflict)
	}
	return nil
}

func (s *InMemoryRunProjectionStore) ListActiveWorkflowRuns(
	_ context.Context,
	afterRunID string,
	limit int,
) ([]execution.ActiveWorkflowRun, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("%w: active workflow limit must be positive", execution.ErrInvalidDurableRun)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	keys := make([]string, 0, len(s.workflowStartIntents))
	for requestID := range s.workflowStartIntents {
		keys = append(keys, requestID)
	}
	sort.Strings(keys)
	result := make([]execution.ActiveWorkflowRun, 0, limit)
	for _, requestID := range keys {
		if requestID <= strings.TrimSpace(afterRunID) {
			continue
		}
		intent := s.workflowStartIntents[requestID]
		run, exists := s.runs[requestID]
		if !exists || intent.State != execution.LifecycleIntentStateConfirmed || !execution.DurableRunStatusIsActive(run.Status) {
			continue
		}
		if command, cancellationRequested := s.cancellationCommands[requestID]; cancellationRequested && command.State != execution.LifecycleIntentStateConfirmed {
			continue
		}
		result = append(result, execution.ActiveWorkflowRun{Run: execution.CloneDurableRun(run), StartIntent: execution.CloneWorkflowStartIntent(intent)})
		if len(result) == limit {
			break
		}
	}
	return result, nil
}

func (s *InMemoryRunProjectionStore) ConfirmWorkflowStartIntent(
	_ context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	if strings.TrimSpace(result.TemporalRunID) == "" {
		return fmt.Errorf("%w: confirmed temporal run id is required", execution.ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, exists := s.workflowStartIntents[result.RequestID]
	if !exists {
		return fmt.Errorf("%w: workflow start request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
	}
	if intent.State == execution.LifecycleIntentStateConfirmed {
		if !intent.DispatchAttempted {
			return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", execution.ErrLifecycleLeaseConflict, result.RequestID)
		}
		if strings.TrimSpace(result.TemporalRunID) != "" &&
			strings.TrimSpace(result.TemporalRunID) != intent.TemporalRunID {
			return fmt.Errorf("%w: confirmed temporal run id differs for request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
		}
		return nil
	}
	if intent.State == execution.LifecycleIntentStateSuperseded {
		return fmt.Errorf("%w: workflow start request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
	}
	if intent.State != execution.LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
	}
	if !intent.DispatchAttempted {
		return fmt.Errorf("%w: workflow start request_id=%s lacks dispatch proof", execution.ErrLifecycleLeaseConflict, result.RequestID)
	}
	run, exists := s.runs[intent.RequestID]
	if !exists {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, intent.RequestID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RequestID]; cancellationRequested {
		intent.State = execution.LifecycleIntentStateSuperseded
		intent.LeaseToken = ""
		intent.LeaseUntil = time.Time{}
		intent.UpdatedAt = result.Now
		s.workflowStartIntents[intent.RequestID] = execution.CloneWorkflowStartIntent(intent)
		return fmt.Errorf("%w: workflow start request_id=%s", execution.ErrLifecycleLeaseConflict, intent.RequestID)
	}

	// Keep the run transition, its lifecycle events, and the intent update in
	// one critical section. A cancellation request takes this same lock and
	// therefore cannot leave a stale start lease able to win afterwards.
	originalRun := execution.CloneDurableRun(run)
	originalEvents := append([]execution.DurableRunEvent(nil), s.runEvents[intent.RequestID]...)
	rollback := func() {
		s.runs[intent.RequestID] = originalRun
		s.runEvents[intent.RequestID] = originalEvents
	}
	if run.Status == execution.DurableRunStatusCreated {
		queuedAt := result.Now
		run.Status = execution.DurableRunStatusQueued
		run.TerminalReason = ""
		run.UpdatedAt = queuedAt
		execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusQueued, queuedAt)
		if err := execution.ValidateDurableRun(run); err != nil {
			return err
		}
		if err := s.appendRunEventLocked(run, execution.DurableRunEvent{
			EventID:              run.RequestID + ":workflow-started",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeWorkflowStarted,
			OccurredAt:           result.Now,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(execution.DurableRunStatusCreated),
				"workflow_id":     intent.WorkflowID,
				"temporal_run_id": strings.TrimSpace(result.TemporalRunID),
				"task_queue":      intent.TaskQueue,
			},
		}); err != nil {
			rollback()
			return err
		}
		if err := s.appendRunEventLocked(run, execution.DurableRunEvent{
			EventID:              run.RequestID + ":run-queued",
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunQueued,
			OccurredAt:           queuedAt,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-event-v1",
			Payload:              map[string]any{"status": string(execution.DurableRunStatusQueued)},
		}); err != nil {
			rollback()
			return err
		}
		s.runs[intent.RequestID] = execution.CloneDurableRun(run)
	}
	intent.State = execution.LifecycleIntentStateConfirmed
	intent.TemporalRunID = strings.TrimSpace(result.TemporalRunID)
	intent.LastErrorCode = ""
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = execution.CloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) RetryWorkflowStartIntent(
	_ context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := execution.LeasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	intent.State = execution.LifecycleIntentStatePending
	intent.NextAttemptAt = result.NextAttemptAt
	intent.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = execution.CloneWorkflowStartIntent(intent)
	return nil
}

func (s *InMemoryRunProjectionStore) FailWorkflowStartIntent(
	_ context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := execution.LeasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	intent.State = execution.LifecycleIntentStatePermanentFailed
	intent.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RequestID] = execution.CloneWorkflowStartIntent(intent)
	return nil
}
