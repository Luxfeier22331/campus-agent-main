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
	if existing, exists := s.runs[run.RunID]; exists {
		if existing.RequestFingerprintSHA256 == run.RequestFingerprintSHA256 {
			return DurableRunCreateResult{Run: cloneDurableRun(existing)}, nil
		}
		return DurableRunCreateResult{}, fmt.Errorf(
			"%w: run_id=%s",
			ErrDurableRunFingerprintConflict,
			run.RunID,
		)
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
		RunID:             run.RunID,
		WorkflowID:        strings.TrimSpace(request.WorkflowID),
		PayloadSHA256:     strings.TrimSpace(request.PayloadSHA256),
		TaskQueue:         strings.TrimSpace(request.TaskQueue),
		WorkflowInputJSON: cloneRawMessage(request.WorkflowInputJSON),
		State:             LifecycleIntentStatePending,
		NextAttemptAt:     run.CreatedAt,
		CreatedAt:         run.CreatedAt,
		UpdatedAt:         run.CreatedAt,
	}
	s.runs[run.RunID] = cloneDurableRun(run)
	s.runEvents[run.RunID] = []DurableRunEvent{event}
	s.workflowStartIntents[run.RunID] = cloneWorkflowStartIntent(intent)
	s.runCleanups[run.RunID] = newPendingRunCleanup(run)
	s.activeRunByConversation[run.ConversationID] = run.RunID
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
	if event.RunID != run.RunID || event.ConversationID != run.ConversationID ||
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
		run, runExists := s.runs[intent.RunID]
		if !runExists {
			continue
		}
		if _, cancellationRequested := s.cancellationCommands[intent.RunID]; cancellationRequested && !durableRunStatusIsTerminal(run.Status) {
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
	runID string,
) (WorkflowStartIntent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	intent, exists := s.workflowStartIntents[strings.TrimSpace(runID)]
	if !exists {
		return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, runID)
	}
	return cloneWorkflowStartIntent(intent), nil
}

func (s *InMemoryRunProjectionStore) MarkWorkflowStartDispatchAttempt(
	_ context.Context,
	result WorkflowStartIntentResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid workflow start dispatch fence", ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	intent, err := leasedWorkflowStartIntent(s.workflowStartIntents, result)
	if err != nil {
		return err
	}
	run, exists := s.runs[intent.RunID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, intent.RunID)
	}
	if !durableRunStatusIsActive(run.Status) {
		return fmt.Errorf("%w: workflow start run_id=%s is not active", ErrLifecycleLeaseConflict, intent.RunID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RunID]; cancellationRequested {
		return fmt.Errorf("%w: workflow start run_id=%s was canceled", ErrLifecycleLeaseConflict, intent.RunID)
	}
	intent.DispatchAttempted = true
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RunID] = cloneWorkflowStartIntent(intent)
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
	if _, exists := s.runs[binding.RunID]; !exists {
		return WorkflowStartIntent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, binding.RunID)
	}
	intent, exists := s.workflowStartIntents[binding.RunID]
	if !exists || intent.RunID != binding.RunID || intent.WorkflowID != binding.WorkflowID ||
		intent.State != LifecycleIntentStateSuperseded || !intent.DispatchAttempted {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: workflow start run_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RunID,
		)
	}
	command, exists := s.cancellationCommands[binding.RunID]
	if !exists || command.RunID != binding.RunID || command.WorkflowID != binding.WorkflowID {
		return WorkflowStartIntent{}, fmt.Errorf(
			"%w: cancellation identity run_id=%s",
			ErrWorkflowStartExecutionBindingConflict,
			binding.RunID,
		)
	}
	existingRunID := strings.TrimSpace(intent.TemporalRunID)
	if existingRunID != "" {
		if existingRunID != binding.TemporalRunID {
			return WorkflowStartIntent{}, fmt.Errorf(
				"%w: temporal run id differs for run_id=%s",
				ErrWorkflowStartExecutionBindingConflict,
				binding.RunID,
			)
		}
		return cloneWorkflowStartIntent(intent), nil
	}
	intent.TemporalRunID = binding.TemporalRunID
	intent.UpdatedAt = binding.Now
	s.workflowStartIntents[binding.RunID] = cloneWorkflowStartIntent(intent)
	return cloneWorkflowStartIntent(intent), nil
}

func canonicalWorkflowStartExecutionBinding(binding WorkflowStartExecutionBinding) WorkflowStartExecutionBinding {
	binding.RunID = strings.TrimSpace(binding.RunID)
	binding.WorkflowID = strings.TrimSpace(binding.WorkflowID)
	binding.TemporalRunID = strings.TrimSpace(binding.TemporalRunID)
	return binding
}

func validateWorkflowStartExecutionBinding(binding WorkflowStartExecutionBinding) error {
	if binding.RunID == "" || binding.WorkflowID == "" || binding.TemporalRunID == "" || binding.Now.IsZero() {
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
	for runID := range s.workflowStartIntents {
		keys = append(keys, runID)
	}
	sort.Strings(keys)
	result := make([]ActiveWorkflowRun, 0, limit)
	for _, runID := range keys {
		if runID <= strings.TrimSpace(afterRunID) {
			continue
		}
		intent := s.workflowStartIntents[runID]
		run, exists := s.runs[runID]
		if !exists || intent.State != LifecycleIntentStateConfirmed || !durableRunStatusIsActive(run.Status) {
			continue
		}
		if command, cancellationRequested := s.cancellationCommands[runID]; cancellationRequested && command.State != LifecycleIntentStateConfirmed {
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
	intent, exists := s.workflowStartIntents[result.RunID]
	if !exists {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if intent.State == LifecycleIntentStateConfirmed {
		if !intent.DispatchAttempted {
			return fmt.Errorf("%w: workflow start run_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RunID)
		}
		if strings.TrimSpace(result.TemporalRunID) != "" &&
			strings.TrimSpace(result.TemporalRunID) != intent.TemporalRunID {
			return fmt.Errorf("%w: confirmed temporal run id differs for run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
		}
		return nil
	}
	if intent.State == LifecycleIntentStateSuperseded {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if !intent.DispatchAttempted {
		return fmt.Errorf("%w: workflow start run_id=%s lacks dispatch proof", ErrLifecycleLeaseConflict, result.RunID)
	}
	run, exists := s.runs[intent.RunID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, intent.RunID)
	}
	if _, cancellationRequested := s.cancellationCommands[intent.RunID]; cancellationRequested {
		intent.State = LifecycleIntentStateSuperseded
		intent.LeaseToken = ""
		intent.LeaseUntil = time.Time{}
		intent.UpdatedAt = result.Now
		s.workflowStartIntents[intent.RunID] = cloneWorkflowStartIntent(intent)
		return fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, intent.RunID)
	}

	// Keep the run transition, its lifecycle events, and the intent update in
	// one critical section. A cancellation request takes this same lock and
	// therefore cannot leave a stale start lease able to win afterwards.
	originalRun := cloneDurableRun(run)
	originalEvents := append([]DurableRunEvent(nil), s.runEvents[intent.RunID]...)
	rollback := func() {
		s.runs[intent.RunID] = originalRun
		s.runEvents[intent.RunID] = originalEvents
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
			EventID:              run.RunID + ":workflow-started",
			RunID:                run.RunID,
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
			EventID:              run.RunID + ":run-queued",
			RunID:                run.RunID,
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
		s.runs[intent.RunID] = cloneDurableRun(run)
	}
	intent.State = LifecycleIntentStateConfirmed
	intent.TemporalRunID = strings.TrimSpace(result.TemporalRunID)
	intent.LastErrorCode = ""
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = result.Now
	s.workflowStartIntents[intent.RunID] = cloneWorkflowStartIntent(intent)
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
	s.workflowStartIntents[intent.RunID] = cloneWorkflowStartIntent(intent)
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
	s.workflowStartIntents[intent.RunID] = cloneWorkflowStartIntent(intent)
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
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status == DurableRunStatusCanceled {
		s.supersedeWorkflowStartIntentLocked(run.RunID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RunID, request.Now)
		return cloneDurableRun(run), nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RunID]; requested {
		if command.Reason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		s.supersedeWorkflowStartIntentLocked(run.RunID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RunID, request.Now)
		return cloneDurableRun(run), nil
	}
	run.UpdatedAt = request.Now
	event := DurableRunEvent{
		EventID: run.RunID + ":run-cancel-requested", RunID: run.RunID,
		ConversationID: run.ConversationID, EventType: DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}
	if err := s.appendRunEventLocked(run, event); err != nil {
		return DurableRun{}, err
	}
	s.runs[run.RunID] = cloneDurableRun(run)
	s.supersedeWorkflowStartIntentLocked(run.RunID, request.Now)
	s.cancellationCommands[run.RunID] = RunCancellationCommand{
		RunID: run.RunID, WorkflowID: "campus-agent.chat." + run.RunID,
		Reason: request.Reason, State: LifecycleIntentStatePending,
		NextAttemptAt: request.Now, CreatedAt: request.Now, UpdatedAt: request.Now,
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) requeueConfirmedCancellationLocked(runID string, now time.Time) {
	command, exists := s.cancellationCommands[runID]
	if !exists || command.State != LifecycleIntentStateConfirmed {
		return
	}
	command.State = LifecycleIntentStatePending
	command.NextAttemptAt = now
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.LastErrorCode = "late_workflow_start"
	command.UpdatedAt = now
	s.cancellationCommands[runID] = command
}

func (s *InMemoryRunProjectionStore) supersedeWorkflowStartIntentLocked(runID string, now time.Time) {
	intent, exists := s.workflowStartIntents[runID]
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
	s.workflowStartIntents[runID] = cloneWorkflowStartIntent(intent)
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
	command, exists := s.cancellationCommands[result.RunID]
	if !exists || command.State != LifecycleIntentStateLeased || command.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: cancellation command run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	command.State = state
	command.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	command.NextAttemptAt = result.NextAttemptAt
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.UpdatedAt = result.Now
	s.cancellationCommands[result.RunID] = command
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
	if _, exists := s.runs[receipt.RunID]; !exists {
		return AgentInvocationReceipt{}, "", fmt.Errorf("%w: %s", ErrDurableRunNotFound, receipt.RunID)
	}
	existing, exists := s.agentInvocationReceipts[receipt.InvocationID]
	if !exists {
		receipt.State = AgentInvocationReceiptStateStarted
		receipt.OutputJSON = nil
		receipt.OutputSHA256 = ""
		s.agentInvocationReceipts[receipt.InvocationID] = cloneAgentInvocationReceipt(receipt)
		return cloneAgentInvocationReceipt(receipt), AgentInvocationDispositionClaimed, nil
	}
	if existing.RunID != receipt.RunID || existing.InputSHA256 != receipt.InputSHA256 {
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
	if !exists || existing.RunID != receipt.RunID || existing.InputSHA256 != receipt.InputSHA256 {
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
	intent, exists := intents[result.RunID]
	if !exists || intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	return intent, nil
}

func validateDurableRunCancellationRequest(request DurableRunCancellationRequest) error {
	if strings.TrimSpace(request.RunID) == "" || request.Reason != "user_requested" || request.Now.IsZero() {
		return fmt.Errorf("%w: invalid cancellation request", ErrInvalidDurableRunCancel)
	}
	return nil
}

func validateAgentInvocationReceipt(receipt AgentInvocationReceipt, completed bool) error {
	if strings.TrimSpace(receipt.InvocationID) == "" || strings.TrimSpace(receipt.RunID) == "" ||
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
