package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) CreateRun(
	_ context.Context,
	run DurableRun,
) (DurableRun, error) {
	if run.Status == "" {
		run.Status = DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[run.RunID]; exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunExists, run.RunID)
	}
	if existingRunID, exists := s.activeRunByConversation[run.ConversationID]; exists {
		return DurableRun{}, fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	s.runs[run.RunID] = cloneDurableRun(run)
	s.runCleanups[run.RunID] = newPendingRunCleanup(run)
	if durableRunStatusIsActive(run.Status) {
		s.activeRunByConversation[run.ConversationID] = run.RunID
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) DeleteRun(_ context.Context, runID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	delete(s.runs, runID)
	delete(s.runEvents, runID)
	for key, payload := range s.protectedPayloads {
		if payload.RunID == runID {
			delete(s.protectedPayloads, key)
		}
	}
	delete(s.workflowStartIntents, runID)
	delete(s.cancellationCommands, runID)
	delete(s.runCleanups, runID)
	for invocationID, receipt := range s.agentInvocationReceipts {
		if receipt.RunID == runID {
			delete(s.agentInvocationReceipts, invocationID)
		}
	}
	delete(s.activeRunByConversation, run.ConversationID)
	return nil
}

func (s *InMemoryRunProjectionStore) GetRun(_ context.Context, runID string) (DurableRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, exists := s.runs[runID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) ReplaceRunMetadata(
	_ context.Context,
	runID string,
	metadata map[string]any,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	run.Metadata = cloneAnyMap(metadata)
	if err := validateDurableRun(run); err != nil {
		return err
	}
	s.runs[runID] = cloneDurableRun(run)
	return nil
}

func (s *InMemoryRunProjectionStore) TransitionRun(
	_ context.Context,
	runID string,
	status DurableRunStatus,
	terminalReason DurableTerminalReason,
	now time.Time,
) (DurableRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	if !durableRunTransitionAllowed(run.Status, status) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			status,
		)
	}
	run.Status = status
	run.TerminalReason = terminalReason
	run.UpdatedAt = now
	recordDurableRunStatusTimestamp(&run, status, now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	s.runs[runID] = cloneDurableRun(run)
	if durableRunStatusIsTerminal(status) {
		delete(s.activeRunByConversation, run.ConversationID)
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) FailRunProjection(
	_ context.Context,
	request DurableRunFailRequest,
) (DurableRun, error) {
	if err := validateDurableRunFailRequest(request); err != nil {
		return DurableRun{}, err
	}
	request = canonicalizeDurableRunFailRequest(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if err := validateDurableRunFailureEventForRun(run, request.TerminalEvent); err != nil {
		return DurableRun{}, err
	}
	if run.Status == DurableRunStatusFailed {
		for _, event := range s.runEvents[run.RunID] {
			if event.EventID != request.TerminalEvent.EventID {
				continue
			}
			if err := validateDurableRunFailureReplay(run, request, event); err != nil {
				return DurableRun{}, err
			}
			return cloneDurableRun(run), nil
		}
		return DurableRun{}, fmt.Errorf(
			"%w: terminal event %s is missing",
			ErrDurableRunFailureConflict,
			request.TerminalEvent.EventID,
		)
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RunID]; requested && command.State != LifecycleIntentStateConfirmed {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusFailed) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusFailed,
		)
	}
	run.Status = DurableRunStatusFailed
	run.TerminalReason = request.TerminalReason
	run.FailCloseReason = request.FailCloseReason
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusFailed, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, request.TerminalEvent); err != nil {
		if errors.Is(err, ErrInvalidRunEvent) {
			return DurableRun{}, fmt.Errorf("%w: %v", ErrDurableRunFailureConflict, err)
		}
		return DurableRun{}, err
	}
	s.runs[request.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) ExpireRunProjection(
	_ context.Context,
	request DurableRunExpireRequest,
) (DurableRun, error) {
	if err := validateDurableRunExpireRequest(request); err != nil {
		return DurableRun{}, err
	}
	request.RunID = strings.TrimSpace(request.RunID)
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status == DurableRunStatusExpired {
		for _, event := range s.runEvents[run.RunID] {
			if event.EventID == run.RunID+":run-expired" {
				if err := validateDurableRunExpiryReplay(run, request, event); err != nil {
					return DurableRun{}, err
				}
				return cloneDurableRun(run), nil
			}
		}
		return DurableRun{}, fmt.Errorf("%w: terminal event is missing", ErrDurableRunExpiryConflict)
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RunID]; requested && command.State != LifecycleIntentStateConfirmed {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusExpired) {
		return DurableRun{}, fmt.Errorf("%w: %s -> %s", ErrInvalidRunTransition, run.Status, DurableRunStatusExpired)
	}
	run.Status = DurableRunStatusExpired
	run.TerminalReason = DurableTerminalReasonRunTimeout
	run.Retryable = true
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, durableRunExpiredEvent(run, request.Now)); err != nil {
		return DurableRun{}, fmt.Errorf("%w: %v", ErrDurableRunExpiryConflict, err)
	}
	s.runs[run.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) CompleteRunProjection(
	_ context.Context,
	request DurableRunCompleteRequest,
) (DurableRun, error) {
	if err := validateDurableRunCompleteRequest(request); err != nil {
		return DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status == DurableRunStatusCompleted &&
		run.TerminalReason == request.TerminalReason &&
		run.FinalResponseRef == request.FinalResponseRef {
		if !matchingFinalizationResultExists(s.stepResults, request) {
			return DurableRun{}, fmt.Errorf(
				"%w: matching completed finalization result is required",
				ErrInvalidDurableRunComplete,
			)
		}
		return cloneDurableRun(run), nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RunID]; requested && command.State != LifecycleIntentStateConfirmed {
		return DurableRun{}, fmt.Errorf("%w: cancellation was requested", ErrDurableRunTerminalConflict)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCompleted) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCompleted,
		)
	}
	if !matchingFinalizationResultExists(s.stepResults, request) {
		return DurableRun{}, fmt.Errorf(
			"%w: matching completed finalization result is required",
			ErrInvalidDurableRunComplete,
		)
	}
	run.Status = DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCompleted, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	s.runs[request.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneDurableRun(run), nil
}

func matchingFinalizationResultExists(
	results map[string]StepResultProjection,
	request DurableRunCompleteRequest,
) bool {
	for _, result := range results {
		if result.RunID == request.RunID && result.StepID == "finalization.write" &&
			result.Status == "completed" && result.ResultKind == "final_answer_projection" &&
			result.ProjectionRef == request.FinalResponseRef {
			return true
		}
	}
	return false
}

func (s *InMemoryRunProjectionStore) CancelRunProjection(
	_ context.Context,
	request DurableRunCancelRequest,
) (DurableRun, error) {
	if err := validateDurableRunCancelRequest(request); err != nil {
		return DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status == DurableRunStatusCanceled {
		return cloneDurableRun(run), nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCanceled) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCanceled,
		)
	}
	run.Status = DurableRunStatusCanceled
	run.TerminalReason = DurableTerminalReasonUserCanceled
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCanceled, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, DurableRunEvent{
		EventID:              run.RunID + ":run-canceled",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunCanceled,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id":      run.RequestID,
			"trace_id":        run.TraceID,
			"status":          string(DurableRunStatusCanceled),
			"terminal_reason": string(DurableTerminalReasonUserCanceled),
		},
	}); err != nil {
		return DurableRun{}, err
	}
	s.runs[run.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneDurableRun(run), nil
}
