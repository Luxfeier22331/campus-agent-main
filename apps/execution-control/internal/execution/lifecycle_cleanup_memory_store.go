package execution

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

func newPendingRunCleanup(run DurableRun) RunCleanup {
	return RunCleanup{
		RunID:         run.RunID,
		State:         LifecycleIntentStatePending,
		NextAttemptAt: run.CreatedAt,
		CreatedAt:     run.CreatedAt,
		UpdatedAt:     run.CreatedAt,
	}
}

func (s *InMemoryRunProjectionStore) GetRunCleanup(
	_ context.Context,
	runID string,
) (RunCleanup, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cleanup, exists := s.runCleanups[strings.TrimSpace(runID)]
	if !exists {
		return RunCleanup{}, fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, runID)
	}
	return cleanup, nil
}

func (s *InMemoryRunProjectionStore) LeaseRunCleanups(
	_ context.Context,
	request LifecycleLeaseRequest,
) ([]RunCleanup, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.runCleanups))
	for key := range s.runCleanups {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left, right int) bool {
		leftCleanup := s.runCleanups[keys[left]]
		rightCleanup := s.runCleanups[keys[right]]
		if !leftCleanup.NextAttemptAt.Equal(rightCleanup.NextAttemptAt) {
			return leftCleanup.NextAttemptAt.Before(rightCleanup.NextAttemptAt)
		}
		if !leftCleanup.CreatedAt.Equal(rightCleanup.CreatedAt) {
			return leftCleanup.CreatedAt.Before(rightCleanup.CreatedAt)
		}
		return keys[left] < keys[right]
	})
	leased := make([]RunCleanup, 0, request.Limit)
	for _, key := range keys {
		cleanup := s.runCleanups[key]
		if !lifecycleIntentLeaseable(cleanup.State, cleanup.NextAttemptAt, cleanup.LeaseUntil, request.Now) ||
			!s.runCleanupEligibleLocked(cleanup.RunID) {
			continue
		}
		cleanup.State = LifecycleIntentStateLeased
		cleanup.AttemptCount++
		cleanup.LeaseToken = request.LeaseToken
		cleanup.LeaseUntil = request.LeaseUntil
		cleanup.UpdatedAt = request.Now
		s.runCleanups[key] = cleanup
		leased = append(leased, cleanup)
		if len(leased) == request.Limit {
			break
		}
	}
	return leased, nil
}

func (s *InMemoryRunProjectionStore) ConfirmRunCleanup(
	_ context.Context,
	result RunCleanupResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid run cleanup confirmation", ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[result.RunID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
	}
	if !durableRunStatusIsTerminal(run.Status) {
		return fmt.Errorf("%w: run cleanup requires terminal run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	cleanup, exists := s.runCleanups[result.RunID]
	if !exists {
		return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	if cleanup.State == LifecycleIntentStateConfirmed {
		return nil
	}
	if cleanup.State != LifecycleIntentStateLeased || cleanup.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	cleanup.State = LifecycleIntentStateConfirmed
	cleanup.LeaseToken = ""
	cleanup.LeaseUntil = time.Time{}
	cleanup.LastErrorCode = ""
	cleanup.ConfirmedAt = result.Now
	cleanup.UpdatedAt = result.Now
	s.runCleanups[result.RunID] = cleanup
	return nil
}

func (s *InMemoryRunProjectionStore) RetryRunCleanup(
	_ context.Context,
	result RunCleanupResult,
) error {
	result.RunID = strings.TrimSpace(result.RunID)
	result.LeaseToken = strings.TrimSpace(result.LeaseToken)
	if result.RunID == "" || result.LeaseToken == "" || result.Now.IsZero() {
		return fmt.Errorf("%w: invalid run cleanup retry", ErrLifecycleLeaseConflict)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	cleanup, exists := s.runCleanups[result.RunID]
	if !exists || cleanup.State != LifecycleIntentStateLeased || cleanup.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: run cleanup run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	run, exists := s.runs[result.RunID]
	if !exists {
		return fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
	}
	if !durableRunStatusIsTerminal(run.Status) {
		return fmt.Errorf("%w: run cleanup requires terminal run_id=%s", ErrLifecycleLeaseConflict, result.RunID)
	}
	nextAttemptAt := result.NextAttemptAt
	if nextAttemptAt.IsZero() {
		nextAttemptAt = result.Now
	}
	cleanup.State = LifecycleIntentStatePending
	cleanup.NextAttemptAt = nextAttemptAt
	cleanup.LeaseToken = ""
	cleanup.LeaseUntil = time.Time{}
	cleanup.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	cleanup.UpdatedAt = result.Now
	s.runCleanups[result.RunID] = cleanup
	return nil
}

func (s *InMemoryRunProjectionStore) runCleanupEligibleLocked(runID string) bool {
	run, runExists := s.runs[runID]
	if !runExists || !durableRunStatusIsTerminal(run.Status) {
		return false
	}
	start, startExists := s.workflowStartIntents[runID]
	if !startExists {
		return false
	}
	temporalRunIDEmpty := strings.TrimSpace(start.TemporalRunID) == ""
	switch start.State {
	case LifecycleIntentStateConfirmed:
		return !temporalRunIDEmpty
	case LifecycleIntentStatePermanentFailed:
		return temporalRunIDEmpty && !start.DispatchAttempted &&
			start.LastErrorCode == "workflow_start_not_dispatched_invalid"
	case LifecycleIntentStateSuperseded:
		return (temporalRunIDEmpty && !start.DispatchAttempted) ||
			(!temporalRunIDEmpty && start.DispatchAttempted)
	default:
		return false
	}
}
