//go:build retired_pg_lease

package execution

import (
	"context"
	"fmt"
	"time"
)

func (s *InMemoryDurableRuntimeStore) AcquireExecutionLease(
	_ context.Context,
	request ExecutionLeaseRequest,
) (ExecutionLease, error) {
	if err := validateExecutionLeaseRequest(request); err != nil {
		return ExecutionLease{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status != DurableRunStatusAdmitted {
		return ExecutionLease{}, fmt.Errorf(
			"%w: cannot lease run in status %s",
			ErrInvalidRunTransition,
			run.Status,
		)
	}
	if _, exists := s.leases[request.LeaseID]; exists {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id %s already exists",
			ErrExecutionLeaseConflict,
			request.LeaseID,
		)
	}
	activeKey := executionLeaseActiveKey(request.RunID, request.StepID)
	if existingLeaseID, exists := s.activeLeaseByRunAndStep[activeKey]; exists {
		return ExecutionLease{}, fmt.Errorf(
			"%w: active lease %s for run_id=%s step_id=%s",
			ErrExecutionLeaseConflict,
			existingLeaseID,
			request.RunID,
			request.StepID,
		)
	}
	if err := s.validateLeaseBudgetAndWorkerLocked(request); err != nil {
		return ExecutionLease{}, err
	}
	lease := ExecutionLease{
		LeaseID:     request.LeaseID,
		RunID:       request.RunID,
		StepID:      request.StepID,
		Lane:        request.Lane,
		WorkerID:    request.WorkerID,
		Attempt:     request.Attempt,
		Status:      ExecutionLeaseStatusLeased,
		AcquiredAt:  request.Now,
		HeartbeatAt: request.Now,
		ExpiresAt:   request.ExpiresAt,
	}
	if err := validateExecutionLease(lease); err != nil {
		return ExecutionLease{}, err
	}
	s.leases[lease.LeaseID] = lease
	s.activeLeaseByRunAndStep[activeKey] = lease.LeaseID
	return lease, nil
}

func (s *InMemoryDurableRuntimeStore) GetExecutionLease(
	_ context.Context,
	leaseID string,
) (ExecutionLease, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lease, exists := s.leases[leaseID]
	if !exists {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
	}
	return lease, nil
}

func (s *InMemoryDurableRuntimeStore) HeartbeatExecutionLease(
	_ context.Context,
	leaseID string,
	workerID string,
	now time.Time,
	expiresAt time.Time,
) (ExecutionLease, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lease, exists := s.leases[leaseID]
	if !exists {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
	}
	if lease.WorkerID != workerID {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s worker_id=%s owner=%s",
			ErrExecutionLeaseDrift,
			leaseID,
			workerID,
			lease.WorkerID,
		)
	}
	if lease.Status != ExecutionLeaseStatusLeased {
		return ExecutionLease{}, fmt.Errorf(
			"%w: heartbeat requires leased status, got %s",
			ErrInvalidExecutionLease,
			lease.Status,
		)
	}
	if !expiresAt.After(now) {
		return ExecutionLease{}, fmt.Errorf(
			"%w: expires_at must be after heartbeat_at",
			ErrInvalidExecutionLease,
		)
	}
	lease.HeartbeatAt = now
	lease.ExpiresAt = expiresAt
	s.leases[leaseID] = lease
	return lease, nil
}

func (s *InMemoryDurableRuntimeStore) ReleaseExecutionLease(
	_ context.Context,
	leaseID string,
	workerID string,
	releaseReason string,
	now time.Time,
) (ExecutionLease, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	lease, exists := s.leases[leaseID]
	if !exists {
		return ExecutionLease{}, fmt.Errorf("%w: %s", ErrExecutionLeaseNotFound, leaseID)
	}
	if lease.WorkerID != workerID {
		return ExecutionLease{}, fmt.Errorf(
			"%w: lease_id=%s worker_id=%s owner=%s",
			ErrExecutionLeaseDrift,
			leaseID,
			workerID,
			lease.WorkerID,
		)
	}
	if lease.Status != ExecutionLeaseStatusLeased {
		return ExecutionLease{}, fmt.Errorf(
			"%w: release requires leased status, got %s",
			ErrInvalidExecutionLease,
			lease.Status,
		)
	}
	if releaseReason == "" {
		return ExecutionLease{}, fmt.Errorf(
			"%w: release_reason is required",
			ErrInvalidExecutionLease,
		)
	}
	lease.Status = ExecutionLeaseStatusReleased
	lease.ReleasedAt = now
	lease.ReleaseReason = releaseReason
	s.leases[leaseID] = lease
	delete(s.activeLeaseByRunAndStep, executionLeaseActiveKey(lease.RunID, lease.StepID))
	return lease, nil
}

func (s *InMemoryDurableRuntimeStore) ExpireExecutionLeases(
	_ context.Context,
	now time.Time,
	releaseReason string,
) ([]ExecutionLease, error) {
	if now.IsZero() {
		return nil, fmt.Errorf("%w: now is required", ErrInvalidExecutionLease)
	}
	if releaseReason == "" {
		return nil, fmt.Errorf("%w: release_reason is required", ErrInvalidExecutionLease)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	expired := []ExecutionLease{}
	for leaseID, lease := range s.leases {
		if lease.Status != ExecutionLeaseStatusLeased || now.Before(lease.ExpiresAt) {
			continue
		}
		lease.Status = ExecutionLeaseStatusExpired
		lease.ReleasedAt = now
		lease.ReleaseReason = releaseReason
		s.leases[leaseID] = lease
		delete(s.activeLeaseByRunAndStep, executionLeaseActiveKey(lease.RunID, lease.StepID))
		expired = append(expired, lease)
	}
	return expired, nil
}

func (s *InMemoryDurableRuntimeStore) RecoverExpiredExecutionLeases(
	_ context.Context,
	request ExpiredLeaseRecoveryRequest,
) ([]ExpiredLeaseRecoveryResult, error) {
	if err := validateExpiredLeaseRecoveryRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	recovered := []ExpiredLeaseRecoveryResult{}
	for leaseID, lease := range s.leases {
		if lease.Status != ExecutionLeaseStatusLeased || request.Now.Before(lease.ExpiresAt) {
			continue
		}
		run, exists := s.runs[lease.RunID]
		if !exists {
			return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, lease.RunID)
		}
		if durableRunStatusIsTerminal(run.Status) {
			continue
		}
		lease.Status = ExecutionLeaseStatusExpired
		lease.ReleasedAt = request.Now
		lease.ReleaseReason = request.ReleaseReason
		s.leases[leaseID] = lease
		delete(s.activeLeaseByRunAndStep, executionLeaseActiveKey(lease.RunID, lease.StepID))
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              lease.LeaseID + ":lease-expired",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeLeaseExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"lease_id":       lease.LeaseID,
				"worker_id":      lease.WorkerID,
				"step_id":        lease.StepID,
				"attempt":        lease.Attempt,
				"release_reason": lease.ReleaseReason,
				"expires_at":     lease.ExpiresAt.Format(time.RFC3339Nano),
			},
		}); err != nil {
			return nil, err
		}
		if lease.Attempt < request.MaxRetryAttempts {
			run.Status = DurableRunStatusQueued
			run.TerminalReason = ""
			run.AdmittedAt = time.Time{}
			run.StartedAt = time.Time{}
			run.StreamingStartedAt = time.Time{}
			run.CompletedAt = time.Time{}
			run.UpdatedAt = request.Now
			recordDurableRunStatusTimestamp(&run, DurableRunStatusQueued, request.Now)
			if err := validateDurableRun(run); err != nil {
				return nil, err
			}
			s.runs[run.RunID] = cloneDurableRun(run)
			if err := s.appendRunEventLocked(run, DurableRunEvent{
				EventID:              lease.LeaseID + ":run-retry-queued",
				RunID:                run.RunID,
				ConversationID:       run.ConversationID,
				EventType:            DurableRunEventTypeRunQueued,
				OccurredAt:           request.Now,
				Visibility:           DurableRunEventVisibilityInternal,
				PayloadSchemaVersion: "run-event-v1",
				Payload: map[string]any{
					"status":             string(DurableRunStatusQueued),
					"retry_reason":       request.ReleaseReason,
					"lease_id":           lease.LeaseID,
					"expired_attempt":    lease.Attempt,
					"next_attempt":       lease.Attempt + 1,
					"max_retry_attempts": request.MaxRetryAttempts,
				},
			}); err != nil {
				return nil, err
			}
			recovered = append(recovered, ExpiredLeaseRecoveryResult{
				Lease: lease,
				Run:   cloneDurableRun(run),
			})
			continue
		}
		run.Status = DurableRunStatusExpired
		run.TerminalReason = request.TerminalReason
		run.UpdatedAt = request.Now
		recordDurableRunStatusTimestamp(&run, DurableRunStatusExpired, request.Now)
		if err := validateDurableRun(run); err != nil {
			return nil, err
		}
		s.runs[run.RunID] = cloneDurableRun(run)
		delete(s.activeRunByConversation, run.ConversationID)
		if err := s.appendRunEventLocked(run, DurableRunEvent{
			EventID:              lease.LeaseID + ":run-expired",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            DurableRunEventTypeRunExpired,
			OccurredAt:           request.Now,
			Visibility:           DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"status":          string(DurableRunStatusExpired),
				"terminal_reason": string(request.TerminalReason),
				"lease_id":        lease.LeaseID,
				"attempt":         lease.Attempt,
			},
		}); err != nil {
			return nil, err
		}
		recovered = append(recovered, ExpiredLeaseRecoveryResult{
			Lease: lease,
			Run:   cloneDurableRun(run),
		})
	}
	return recovered, nil
}

func (s *InMemoryDurableRuntimeStore) validateLeaseBudgetAndWorkerLocked(
	request ExecutionLeaseRequest,
) error {
	budget, exists := s.laneBudgets[request.Lane]
	if !exists {
		return fmt.Errorf("%w: %s", ErrLaneBudgetNotFound, request.Lane)
	}
	if !budget.Enabled {
		return fmt.Errorf("%w: %s", ErrLaneBudgetDisabled, request.Lane)
	}
	if activeLeaseCountForLane(s.leases, request.Lane) >= budget.MaxActiveLeases {
		return fmt.Errorf("%w: %s", ErrLaneBudgetExceeded, request.Lane)
	}
	heartbeat, exists := s.workerHeartbeats[request.WorkerID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrWorkerHeartbeatNotFound, request.WorkerID)
	}
	return validateWorkerCanLease(heartbeat, request.Lane, request.Now, budget)
}
