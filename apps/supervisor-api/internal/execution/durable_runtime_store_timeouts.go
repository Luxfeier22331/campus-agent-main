package execution

import (
	"context"
	"fmt"
	"time"
)

func (s *InMemoryDurableRuntimeStore) RecoverTimedOutRuns(
	_ context.Context,
	request TimedOutRunRecoveryRequest,
) ([]TimedOutRunRecoveryResult, error) {
	if err := validateTimedOutRunRecoveryRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	recovered := []TimedOutRunRecoveryResult{}
	for runID, run := range s.runs {
		if durableRunStatusIsTerminal(run.Status) {
			continue
		}
		budget, exists := s.laneBudgets[run.Lane]
		if !exists {
			return nil, fmt.Errorf("%w: %s", ErrLaneBudgetNotFound, run.Lane)
		}
		if !budget.Enabled {
			continue
		}
		terminalReason, timedOut := durableRunTimedOut(run, budget, request.Now)
		if !timedOut {
			continue
		}
		if err := s.expireActiveLeaseForTimedOutRunLocked(run, request.Now, terminalReason); err != nil {
			return nil, err
		}
		run.Status = DurableRunStatusExpired
		run.TerminalReason = terminalReason
		run.UpdatedAt = request.Now
		recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
		if err := validateDurableRun(run); err != nil {
			return nil, err
		}
		s.runs[runID] = cloneDurableRun(run)
		delete(s.activeRunByConversation, run.ConversationID)
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              run.RunID + ":run-timeout",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusExpired),
				"terminal_reason": string(terminalReason),
			},
		}); err != nil {
			return nil, err
		}
		recovered = append(recovered, TimedOutRunRecoveryResult{
			Run:            cloneDurableRun(run),
			TerminalReason: terminalReason,
		})
	}
	return recovered, nil
}

func (s *InMemoryDurableRuntimeStore) expireActiveLeaseForTimedOutRunLocked(
	run DurableRun,
	now time.Time,
	terminalReason DurableTerminalReason,
) error {
	for leaseID, lease := range s.leases {
		if lease.RunID != run.RunID || lease.Status != ExecutionLeaseStatusLeased {
			continue
		}
		lease.Status = ExecutionLeaseStatusExpired
		lease.ReleasedAt = now
		lease.ReleaseReason = string(terminalReason)
		s.leases[leaseID] = lease
		delete(s.activeLeaseByRunAndStep, executionLeaseActiveKey(lease.RunID, lease.StepID))
		return s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              lease.LeaseID + ":lease-timeout",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeLeaseExpired,
			OccurredAt:           now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"lease_id":       lease.LeaseID,
				"worker_id":      lease.WorkerID,
				"step_id":        lease.StepID,
				"attempt":        lease.Attempt,
				"release_reason": string(terminalReason),
			},
		})
	}
	return nil
}

func durableRunTimedOut(
	run DurableRun,
	budget LaneBudget,
	now time.Time,
) (DurableTerminalReason, bool) {
	switch run.Status {
	case DurableRunStatusQueued:
		if !run.QueuedAt.IsZero() && !now.Before(run.QueuedAt.Add(budget.QueueTimeout)) {
			return DurableTerminalReasonQueueTimeout, true
		}
	case DurableRunStatusAdmitted, DurableRunStatusRunning, DurableRunStatusStreaming:
		startedAt := run.StartedAt
		if startedAt.IsZero() {
			startedAt = run.AdmittedAt
		}
		if !startedAt.IsZero() && !now.Before(startedAt.Add(budget.RunTimeout)) {
			return DurableTerminalReasonRunTimeout, true
		}
	}
	return "", false
}
