package execution

import (
	"context"
	"fmt"
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
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
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
	if request.SelectedCapability != "" {
		run.SelectedCapability = request.SelectedCapability
	}
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusFailed, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	s.runs[request.RunID] = cloneDurableRun(run)
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
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCompleted) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCompleted,
		)
	}
	run.Status = DurableRunStatusCompleted
	run.TerminalReason = request.TerminalReason
	run.FinalResponseRef = request.FinalResponseRef
	if request.SelectedCapability != "" {
		run.SelectedCapability = request.SelectedCapability
	}
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCompleted, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	s.runs[request.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneDurableRun(run), nil
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
	s.runs[run.RunID] = cloneDurableRun(run)
	delete(s.activeRunByConversation, run.ConversationID)
	if err := s.appendRunEventLocked(run, DurableRunEvent{
		EventID:              run.RunID + ":run-canceled",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunCanceled,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"status":          string(DurableRunStatusCanceled),
			"terminal_reason": string(DurableTerminalReasonUserCanceled),
			"reason":          request.Reason,
			"projection_only": true,
		},
	}); err != nil {
		return DurableRun{}, err
	}
	return cloneDurableRun(run), nil
}
