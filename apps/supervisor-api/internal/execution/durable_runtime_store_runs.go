package execution

import (
	"context"
	"fmt"
	"time"
)

func (s *InMemoryDurableRuntimeStore) CreateRun(
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

func (s *InMemoryDurableRuntimeStore) GetRun(_ context.Context, runID string) (DurableRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, exists := s.runs[runID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryDurableRuntimeStore) TransitionRun(
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

func (s *InMemoryDurableRuntimeStore) CancelRun(
	_ context.Context,
	request DurableRunCancelRequest,
) (DurableRunCancelResult, error) {
	if err := validateDurableRunCancelRequest(request); err != nil {
		return DurableRunCancelResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRunCancelResult{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCanceled) {
		return DurableRunCancelResult{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCanceled,
		)
	}
	var releasedLease *ExecutionLease
	for leaseID, lease := range s.leases {
		if lease.RunID != run.RunID || lease.Status != ExecutionLeaseStatusLeased {
			continue
		}
		lease.Status = ExecutionLeaseStatusReleased
		lease.ReleasedAt = request.Now
		lease.ReleaseReason = request.ReleaseReason
		s.leases[leaseID] = lease
		delete(s.activeLeaseByRunAndStep, executionLeaseActiveKey(lease.RunID, lease.StepID))
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              lease.LeaseID + ":lease-released-cancel",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeLeaseReleased,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"lease_id":       lease.LeaseID,
				"worker_id":      lease.WorkerID,
				"step_id":        lease.StepID,
				"release_reason": request.ReleaseReason,
			},
		}); err != nil {
			return DurableRunCancelResult{}, err
		}
		leaseCopy := lease
		releasedLease = &leaseCopy
		break
	}
	run.Status = DurableRunStatusCanceled
	run.TerminalReason = DurableTerminalReasonUserCanceled
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCanceled, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRunCancelResult{}, err
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
		},
	}); err != nil {
		return DurableRunCancelResult{}, err
	}
	return DurableRunCancelResult{
		Run:           cloneDurableRun(run),
		ReleasedLease: releasedLease,
	}, nil
}
