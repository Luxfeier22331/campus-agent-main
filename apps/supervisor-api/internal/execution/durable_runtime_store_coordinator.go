package execution

import (
	"context"
	"fmt"
)

func (s *InMemoryDurableRuntimeStore) AcquireNextExecutionLease(
	_ context.Context,
	request NextExecutionLeaseRequest,
) (ExecutionLease, error) {
	if err := validateNextExecutionLeaseRequest(request); err != nil {
		return ExecutionLease{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.leases[request.LeaseID]; exists {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id %s already exists",
			ErrExecutionLeaseConflict,
			request.LeaseID,
		)
	}
	runID, run, err := s.nextQueuedRunLocked(request.Lane)
	if err != nil {
		return ExecutionLease{}, err
	}
	leaseRequest := ExecutionLeaseRequest{
		LeaseID:   request.LeaseID,
		RunID:     runID,
		StepID:    request.StepID,
		Lane:      request.Lane,
		WorkerID:  request.WorkerID,
		Attempt:   s.nextLeaseAttemptLocked(runID, request.StepID),
		Now:       request.Now,
		ExpiresAt: request.ExpiresAt,
	}
	if err := s.validateExecutionLeaseRequestLocked(leaseRequest); err != nil {
		return ExecutionLease{}, err
	}
	run.Status = DurableRunStatusAdmitted
	run.AdmittedAt = request.Now
	run.UpdatedAt = request.Now
	if err := validateDurableRun(run); err != nil {
		return ExecutionLease{}, err
	}
	s.runs[runID] = cloneDurableRun(run)
	if err := s.appendRunEventLocked(run, DurableRunEvent{
		EventID:              request.LeaseID + ":run-admitted",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunAdmitted,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(DurableRunStatusAdmitted)},
	}); err != nil {
		return ExecutionLease{}, err
	}
	lease := ExecutionLease{
		LeaseID:     request.LeaseID,
		RunID:       run.RunID,
		StepID:      request.StepID,
		Lane:        request.Lane,
		WorkerID:    request.WorkerID,
		Attempt:     leaseRequest.Attempt,
		Status:      ExecutionLeaseStatusLeased,
		AcquiredAt:  request.Now,
		HeartbeatAt: request.Now,
		ExpiresAt:   request.ExpiresAt,
	}
	if err := validateExecutionLease(lease); err != nil {
		return ExecutionLease{}, err
	}
	activeKey := executionLeaseActiveKey(lease.RunID, lease.StepID)
	s.leases[lease.LeaseID] = lease
	s.activeLeaseByRunAndStep[activeKey] = lease.LeaseID
	if err := s.appendRunEventLocked(run, DurableRunEvent{
		EventID:              request.LeaseID + ":lease-acquired",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeLeaseAcquired,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"lease_id":  lease.LeaseID,
			"worker_id": lease.WorkerID,
			"step_id":   lease.StepID,
			"attempt":   lease.Attempt,
		},
	}); err != nil {
		return ExecutionLease{}, err
	}
	run.Status = DurableRunStatusRunning
	run.StartedAt = request.Now
	run.UpdatedAt = request.Now
	if err := validateDurableRun(run); err != nil {
		return ExecutionLease{}, err
	}
	s.runs[runID] = cloneDurableRun(run)
	if err := s.appendRunEventLocked(run, DurableRunEvent{
		EventID:              request.LeaseID + ":run-started",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunStarted,
		OccurredAt:           request.Now,
		Visibility:           DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(DurableRunStatusRunning)},
	}); err != nil {
		return ExecutionLease{}, err
	}
	return lease, nil
}

func (s *InMemoryDurableRuntimeStore) nextLeaseAttemptLocked(runID string, stepID string) int {
	maxAttempt := 0
	for _, lease := range s.leases {
		if lease.RunID == runID && lease.StepID == stepID && lease.Attempt > maxAttempt {
			maxAttempt = lease.Attempt
		}
	}
	return maxAttempt + 1
}

func (s *InMemoryDurableRuntimeStore) nextQueuedRunLocked(
	lane DurableLane,
) (string, DurableRun, error) {
	selectedRunID := ""
	var selected DurableRun
	for runID, run := range s.runs {
		if run.Lane != lane || run.Status != DurableRunStatusQueued {
			continue
		}
		if selectedRunID == "" || run.QueuedAt.Before(selected.QueuedAt) ||
			(run.QueuedAt.Equal(selected.QueuedAt) && run.CreatedAt.Before(selected.CreatedAt)) {
			selectedRunID = runID
			selected = run
		}
	}
	if selectedRunID == "" {
		return "", DurableRun{}, fmt.Errorf("%w: lane=%s", ErrNoQueuedDurableRun, lane)
	}
	return selectedRunID, cloneDurableRun(selected), nil
}

func (s *InMemoryDurableRuntimeStore) validateExecutionLeaseRequestLocked(
	request ExecutionLeaseRequest,
) error {
	if activeKey := executionLeaseActiveKey(request.RunID, request.StepID); activeKey != "" {
		if existingLeaseID, exists := s.activeLeaseByRunAndStep[activeKey]; exists {
			return fmt.Errorf(
				"%w: active lease %s for run_id=%s step_id=%s",
				ErrExecutionLeaseConflict,
				existingLeaseID,
				request.RunID,
				request.StepID,
			)
		}
	}
	return s.validateLeaseBudgetAndWorkerLocked(request)
}

func (s *InMemoryDurableRuntimeStore) appendRunEventLocked(
	run DurableRun,
	event DurableRunEvent,
) error {
	events := s.runEvents[run.RunID]
	event.Sequence = int64(len(events) + 1)
	if event.ConversationID != run.ConversationID {
		return fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	if err := validateDurableRunEventBase(event); err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID == event.EventID {
			return fmt.Errorf("%w: event_id %s already exists", ErrInvalidRunEvent, event.EventID)
		}
	}
	s.runEvents[run.RunID] = append(events, cloneDurableRunEvent(event))
	return nil
}
