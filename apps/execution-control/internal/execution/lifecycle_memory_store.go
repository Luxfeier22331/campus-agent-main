package execution

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
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

func (s *InMemoryRunProjectionStore) RequestRunCancellation(
	_ context.Context,
	request DurableRunCancellationRequest,
) (DurableRun, error) {
	if err := validateDurableRunCancellationRequest(request); err != nil {
		return DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == DurableRunStatusCanceled {
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return cloneDurableRun(run), nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested {
		if command.Reason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return cloneDurableRun(run), nil
	}
	run.UpdatedAt = request.Now
	event := DurableRunEvent{
		EventID: run.RequestID + ":run-cancel-requested", RequestID: run.RequestID,
		ConversationID: run.ConversationID, EventType: DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}
	if err := s.appendRunEventLocked(run, event); err != nil {
		return DurableRun{}, err
	}
	s.runs[run.RequestID] = cloneDurableRun(run)
	s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
	s.cancellationCommands[run.RequestID] = RunCancellationCommand{
		RequestID: run.RequestID, WorkflowID: "campus-agent.chat." + run.RequestID,
		Reason: request.Reason, State: LifecycleIntentStatePending,
		NextAttemptAt: request.Now, CreatedAt: request.Now, UpdatedAt: request.Now,
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) requeueConfirmedCancellationLocked(requestID string, now time.Time) {
	command, exists := s.cancellationCommands[requestID]
	if !exists || command.State != LifecycleIntentStateConfirmed {
		return
	}
	command.State = LifecycleIntentStatePending
	command.NextAttemptAt = now
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.LastErrorCode = "late_workflow_start"
	command.UpdatedAt = now
	s.cancellationCommands[requestID] = command
}

func (s *InMemoryRunProjectionStore) supersedeWorkflowStartIntentLocked(requestID string, now time.Time) {
	intent, exists := s.workflowStartIntents[requestID]
	if !exists {
		return
	}
	if intent.State != LifecycleIntentStatePending && intent.State != LifecycleIntentStateLeased {
		return
	}
	intent.State = LifecycleIntentStateSuperseded
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = now
	s.workflowStartIntents[requestID] = cloneWorkflowStartIntent(intent)
}

func (s *InMemoryRunProjectionStore) LeaseRunCancellationCommands(
	_ context.Context,
	request LifecycleLeaseRequest,
) ([]RunCancellationCommand, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.cancellationCommands))
	for key := range s.cancellationCommands {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	leased := make([]RunCancellationCommand, 0, request.Limit)
	for _, key := range keys {
		command := s.cancellationCommands[key]
		if !lifecycleIntentLeaseable(command.State, command.NextAttemptAt, command.LeaseUntil, request.Now) {
			continue
		}
		command.State = LifecycleIntentStateLeased
		command.LeaseToken = request.LeaseToken
		command.LeaseUntil = request.LeaseUntil
		command.AttemptCount++
		command.UpdatedAt = request.Now
		s.cancellationCommands[key] = command
		leased = append(leased, command)
		if len(leased) == request.Limit {
			break
		}
	}
	return leased, nil
}

func (s *InMemoryRunProjectionStore) ConfirmRunCancellationCommand(
	_ context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, LifecycleIntentStateConfirmed)
}

func (s *InMemoryRunProjectionStore) RetryRunCancellationCommand(
	_ context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, LifecycleIntentStatePending)
}

func (s *InMemoryRunProjectionStore) updateCancellationCommand(
	result RunCancellationCommandResult,
	state LifecycleIntentState,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	command, exists := s.cancellationCommands[result.RequestID]
	if !exists || command.State != LifecycleIntentStateLeased || command.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: cancellation command request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	command.State = state
	command.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	command.NextAttemptAt = result.NextAttemptAt
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.UpdatedAt = result.Now
	s.cancellationCommands[result.RequestID] = command
	return nil
}

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

func validateLifecycleLeaseRequest(request LifecycleLeaseRequest) error {
	if strings.TrimSpace(request.LeaseToken) == "" || request.Now.IsZero() ||
		!request.LeaseUntil.After(request.Now) || request.Limit < 1 || request.Limit > 100 {
		return fmt.Errorf("%w: invalid lifecycle lease request", ErrLifecycleLeaseConflict)
	}
	return nil
}

func lifecycleIntentLeaseable(state LifecycleIntentState, next, leaseUntil, now time.Time) bool {
	if next.After(now) {
		return false
	}
	switch state {
	case LifecycleIntentStatePending:
		return true
	case LifecycleIntentStateLeased:
		return !leaseUntil.After(now)
	default:
		// Confirmed, superseded, and permanently failed intents are retired and
		// must never be leased again.
		return false
	}
}

func leasedWorkflowStartIntent(
	intents map[string]WorkflowStartIntent,
	result WorkflowStartIntentResult,
) (WorkflowStartIntent, error) {
	intent, exists := intents[result.RequestID]
	if !exists || intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	return intent, nil
}

func validateDurableRunCancellationRequest(request DurableRunCancellationRequest) error {
	if strings.TrimSpace(request.RequestID) == "" || request.Reason != "user_requested" || request.Now.IsZero() {
		return fmt.Errorf("%w: invalid cancellation request", ErrInvalidDurableRunCancel)
	}
	return nil
}

func validateAgentInvocationReceipt(receipt AgentInvocationReceipt, completed bool) error {
	if strings.TrimSpace(receipt.InvocationID) == "" || strings.TrimSpace(receipt.RequestID) == "" ||
		!validLowerHexSHA256(receipt.InputSHA256) || receipt.CreatedAt.IsZero() || receipt.UpdatedAt.IsZero() {
		return fmt.Errorf("%w: invalid invocation receipt", ErrAgentInvocationConflict)
	}
	if completed && (!validLowerHexSHA256(receipt.OutputSHA256) || !json.Valid(receipt.OutputJSON) || receipt.CompletedAt.IsZero()) {
		return fmt.Errorf("%w: invalid completed invocation receipt", ErrAgentInvocationConflict)
	}
	return nil
}

func cloneRawMessage(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}

func cloneWorkflowStartIntent(intent WorkflowStartIntent) WorkflowStartIntent {
	clone := intent
	clone.WorkflowInputJSON = cloneRawMessage(intent.WorkflowInputJSON)
	return clone
}

func cloneAgentInvocationReceipt(receipt AgentInvocationReceipt) AgentInvocationReceipt {
	clone := receipt
	clone.OutputJSON = cloneRawMessage(receipt.OutputJSON)
	return clone
}
