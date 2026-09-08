package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *InMemoryRunProjectionStore) CreateRun(
	_ context.Context,
	run execution.DurableRun,
) (execution.DurableRun, error) {
	if run.Status == "" {
		run.Status = execution.DurableRunStatusCreated
	}
	if run.UpdatedAt.IsZero() {
		run.UpdatedAt = run.CreatedAt
	}
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[run.RequestID]; exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunExists, run.RequestID)
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == execution.OwnerDeletionStateDeleted {
		return execution.DurableRun{}, execution.ErrOwnerDeleted
	}
	if state := s.ownerDeletionFences[run.OwnerUserID]; state == execution.OwnerDeletionStateDraining {
		return execution.DurableRun{}, execution.ErrOwnerDeletionNotDrained
	}
	if existingRunID, exists := s.activeRunByConversation[run.ConversationID]; exists {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: conversation_id=%s active_run_id=%s",
			execution.ErrConversationActiveRun,
			run.ConversationID,
			existingRunID,
		)
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(run)
	if execution.DurableRunStatusIsActive(run.Status) {
		s.activeRunByConversation[run.ConversationID] = run.RequestID
	}
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) DeleteRun(_ context.Context, requestID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[requestID]
	if !exists {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	delete(s.runs, requestID)
	delete(s.runEvents, requestID)
	delete(s.workflowStartIntents, requestID)
	delete(s.cancellationCommands, requestID)
	s.Receipts.deleteRunLocked(requestID)
	delete(s.activeRunByConversation, run.ConversationID)
	return nil
}

func (s *InMemoryRunProjectionStore) GetRun(_ context.Context, requestID string) (execution.DurableRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, exists := s.runs[requestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) ReplaceRunMetadata(
	_ context.Context,
	requestID string,
	metadata map[string]any,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[requestID]
	if !exists {
		return fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	run.Metadata = cloneAnyMap(metadata)
	if err := execution.ValidateDurableRun(run); err != nil {
		return err
	}
	s.runs[requestID] = execution.CloneDurableRun(run)
	return nil
}

func (s *InMemoryRunProjectionStore) TransitionRun(
	_ context.Context,
	requestID string,
	status execution.DurableRunStatus,
	terminalReason execution.DurableTerminalReason,
	now time.Time,
) (execution.DurableRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[requestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, status) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			status,
		)
	}
	run.Status = status
	run.TerminalReason = terminalReason
	run.UpdatedAt = now
	execution.RecordDurableRunStatusTimestamp(&run, status, now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	s.runs[requestID] = execution.CloneDurableRun(run)
	if execution.DurableRunStatusIsTerminal(status) {
		delete(s.activeRunByConversation, run.ConversationID)
	}
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) FailRunProjection(
	_ context.Context,
	request execution.DurableRunFailRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunFailRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	request = execution.CanonicalizeDurableRunFailRequest(request)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if err := execution.ValidateDurableRunFailureEventForRun(run, request.TerminalEvent); err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusFailed {
		for _, event := range s.runEvents[run.RequestID] {
			if event.EventID != request.TerminalEvent.EventID {
				continue
			}
			if err := execution.ValidateDurableRunFailureReplay(run, request, event); err != nil {
				return execution.DurableRun{}, err
			}
			return execution.CloneDurableRun(run), nil
		}
		return execution.DurableRun{}, fmt.Errorf(
			"%w: terminal event %s is missing",
			execution.ErrDurableRunFailureConflict,
			request.TerminalEvent.EventID,
		)
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested && command.State != execution.LifecycleIntentStateConfirmed {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusFailed) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusFailed,
		)
	}
	run.Status = execution.DurableRunStatusFailed
	run.TerminalReason = request.TerminalReason
	run.FailCloseReason = request.FailCloseReason
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusFailed, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, request.TerminalEvent); err != nil {
		if errors.Is(err, execution.ErrInvalidRunEvent) {
			return execution.DurableRun{}, fmt.Errorf("%w: %v", execution.ErrDurableRunFailureConflict, err)
		}
		return execution.DurableRun{}, err
	}
	s.runs[request.RequestID] = execution.CloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) ExpireRunProjection(
	_ context.Context,
	request execution.DurableRunExpireRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunExpireRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == execution.DurableRunStatusExpired {
		for _, event := range s.runEvents[run.RequestID] {
			if event.EventID == run.RequestID+":run-expired" {
				if err := execution.ValidateDurableRunExpiryReplay(run, request, event); err != nil {
					return execution.DurableRun{}, err
				}
				return execution.CloneDurableRun(run), nil
			}
		}
		return execution.DurableRun{}, fmt.Errorf("%w: terminal event is missing", execution.ErrDurableRunExpiryConflict)
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested && command.State != execution.LifecycleIntentStateConfirmed {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusExpired) {
		return execution.DurableRun{}, fmt.Errorf("%w: %s -> %s", execution.ErrInvalidRunTransition, run.Status, execution.DurableRunStatusExpired)
	}
	run.Status = execution.DurableRunStatusExpired
	run.TerminalReason = execution.DurableTerminalReasonRunTimeout
	run.Retryable = true
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusExpired, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, execution.DurableRunExpiredEvent(run, request.Now)); err != nil {
		return execution.DurableRun{}, fmt.Errorf("%w: %v", execution.ErrDurableRunExpiryConflict, err)
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) CompleteRunProjection(
	_ context.Context,
	request execution.DurableRunCompleteRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCompleteRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == execution.DurableRunStatusCompleted &&
		run.TerminalReason == request.TerminalReason &&
		run.FinalResponseRef == request.FinalResponseRef {
		if !matchingFinalizationResultExists(s.stepResults, request) {
			return execution.DurableRun{}, fmt.Errorf(
				"%w: matching completed finalization result is required",
				execution.ErrInvalidDurableRunComplete,
			)
		}
		return execution.CloneDurableRun(run), nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested && command.State != execution.LifecycleIntentStateConfirmed {
		return execution.DurableRun{}, fmt.Errorf("%w: cancellation was requested", execution.ErrDurableRunTerminalConflict)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusCompleted) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusCompleted,
		)
	}
	if !matchingFinalizationResultExists(s.stepResults, request) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: matching completed finalization result is required",
			execution.ErrInvalidDurableRunComplete,
		)
	}
	run.Status = execution.DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusCompleted, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	s.runs[request.RequestID] = execution.CloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return execution.CloneDurableRun(run), nil
}

func matchingFinalizationResultExists(
	results map[string]execution.StepResultProjection,
	request execution.DurableRunCompleteRequest,
) bool {
	for _, result := range results {
		if result.RequestID == request.RequestID && result.StepID == "finalization.write" &&
			result.Status == "completed" && result.ResultKind == "final_answer_projection" &&
			result.ProjectionRef == request.FinalResponseRef {
			return true
		}
	}
	return false
}

func (s *InMemoryRunProjectionStore) CancelRunProjection(
	_ context.Context,
	request execution.DurableRunCancelRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCancelRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		return execution.CloneDurableRun(run), nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if !execution.DurableRunTransitionAllowed(run.Status, execution.DurableRunStatusCanceled) {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusCanceled,
		)
	}
	run.Status = execution.DurableRunStatusCanceled
	run.TerminalReason = execution.DurableTerminalReasonUserCanceled
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusCanceled, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := s.appendRunEventLocked(run, execution.DurableRunEvent{
		EventID:              run.RequestID + ":run-canceled",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCanceled,
		OccurredAt:           request.Now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"request_id":      run.RequestID,
			"status":          string(execution.DurableRunStatusCanceled),
			"terminal_reason": string(execution.DurableTerminalReasonUserCanceled),
		},
	}); err != nil {
		return execution.DurableRun{}, err
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return execution.CloneDurableRun(run), nil
}
