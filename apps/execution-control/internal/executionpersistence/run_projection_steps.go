package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"sort"
	"strings"
)

func (s *InMemoryRunProjectionStore) UpsertRunStep(
	_ context.Context,
	step execution.RunStepProjection,
) (execution.RunStepProjection, error) {
	if err := execution.ValidateRunStepProjection(step); err != nil {
		return execution.RunStepProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[step.RequestID]; !exists {
		return execution.RunStepProjection{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, step.RequestID)
	}
	key := execution.RunStepKey(step.RequestID, step.StepID)
	if current, exists := s.runSteps[key]; exists && !execution.RunStepProjectionUpdateAllowed(current, step) {
		return execution.CloneRunStepProjection(current), fmt.Errorf(
			"%w: run=%s step=%s status=%s activity_attempt=%d current_status=%s current_activity_attempt=%d",
			execution.ErrStaleRunStepProjection,
			step.RequestID,
			step.StepID,
			step.Status,
			step.ActivityAttempt,
			current.Status,
			current.ActivityAttempt,
		)
	}
	s.runSteps[key] = execution.CloneRunStepProjection(step)
	return execution.CloneRunStepProjection(step), nil
}

func (s *InMemoryRunProjectionStore) UpsertStepAttempt(
	_ context.Context,
	attempt execution.StepAttemptProjection,
) (execution.StepAttemptProjection, error) {
	if err := execution.ValidateStepAttemptProjection(attempt); err != nil {
		return execution.StepAttemptProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[attempt.RequestID]; !exists {
		return execution.StepAttemptProjection{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, attempt.RequestID)
	}
	for _, current := range s.stepAttempts {
		if current.AttemptID == attempt.AttemptID &&
			(current.RequestID != attempt.RequestID || current.StepID != attempt.StepID) {
			return execution.StepAttemptProjection{}, fmt.Errorf(
				"%w: attempt_id=%s is already bound to run=%s step=%s",
				execution.ErrStaleStepAttemptProjection,
				attempt.AttemptID,
				current.RequestID,
				current.StepID,
			)
		}
		if current.RequestID == attempt.RequestID && current.StepID == attempt.StepID &&
			current.Attempt == attempt.Attempt && current.AttemptID != attempt.AttemptID {
			return execution.StepAttemptProjection{}, fmt.Errorf(
				"%w: run=%s step=%s attempt=%d is already bound to attempt_id=%s",
				execution.ErrStaleStepAttemptProjection,
				attempt.RequestID,
				attempt.StepID,
				attempt.Attempt,
				current.AttemptID,
			)
		}
	}
	key := execution.StepAttemptKey(attempt.RequestID, attempt.AttemptID)
	if current, exists := s.stepAttempts[key]; exists && !execution.StepAttemptProjectionUpdateAllowed(current, attempt) {
		return execution.CloneStepAttemptProjection(current), fmt.Errorf(
			"%w: run=%s step=%s attempt_id=%s status=%s activity_attempt=%d current_status=%s current_activity_attempt=%d",
			execution.ErrStaleStepAttemptProjection,
			attempt.RequestID,
			attempt.StepID,
			attempt.AttemptID,
			attempt.Status,
			attempt.ActivityAttempt,
			current.Status,
			current.ActivityAttempt,
		)
	}
	s.stepAttempts[key] = execution.CloneStepAttemptProjection(attempt)
	return execution.CloneStepAttemptProjection(attempt), nil
}

func (s *InMemoryRunProjectionStore) UpsertStepResult(
	_ context.Context,
	result execution.StepResultProjection,
) (execution.StepResultProjection, error) {
	if err := execution.ValidateStepResultProjection(result); err != nil {
		return execution.StepResultProjection{}, err
	}
	var err error
	result, err = execution.CanonicalStepResultProjection(result)
	if err != nil {
		return execution.StepResultProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[result.RequestID]
	if !exists {
		return execution.StepResultProjection{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, result.RequestID)
	}
	if !execution.StepResultProjectionWriteAllowed(run.Status, result) {
		return execution.StepResultProjection{}, fmt.Errorf(
			"%w: run=%s status=%s",
			execution.ErrDurableRunTerminalConflict,
			result.RequestID,
			run.Status,
		)
	}
	for _, current := range s.stepResults {
		if current.ResultID == result.ResultID &&
			(current.RequestID != result.RequestID || current.StepID != result.StepID) {
			return execution.StepResultProjection{}, fmt.Errorf(
				"%w: result_id=%s is already bound to run=%s step=%s",
				execution.ErrStepResultProjectionConflict,
				result.ResultID,
				current.RequestID,
				current.StepID,
			)
		}
	}
	key := execution.StepResultKey(result.RequestID, result.ResultID)
	if current, exists := s.stepResults[key]; exists {
		if execution.StepResultProjectionEquivalent(current, result) {
			return execution.CloneStepResultProjection(current), nil
		}
		return execution.CloneStepResultProjection(current), fmt.Errorf(
			"%w: run=%s result=%s",
			execution.ErrStepResultProjectionConflict,
			result.RequestID,
			result.ResultID,
		)
	}
	s.stepResults[key] = execution.CloneStepResultProjection(result)
	return execution.CloneStepResultProjection(result), nil
}

func (s *InMemoryRunProjectionStore) ListRunSteps(
	_ context.Context,
	requestID string,
) ([]execution.RunStepProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[requestID]; !exists {
		return nil, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	steps := []execution.RunStepProjection{}
	prefix := strings.TrimSpace(requestID) + "\x00"
	for key, step := range s.runSteps {
		if strings.HasPrefix(key, prefix) {
			steps = append(steps, execution.CloneRunStepProjection(step))
		}
	}
	sort.Slice(steps, func(left int, right int) bool {
		if steps[left].StartedAt.Equal(steps[right].StartedAt) {
			return steps[left].StepID < steps[right].StepID
		}
		return steps[left].StartedAt.Before(steps[right].StartedAt)
	})
	return steps, nil
}

func (s *InMemoryRunProjectionStore) ListStepAttempts(
	_ context.Context,
	requestID string,
) ([]execution.StepAttemptProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[requestID]; !exists {
		return nil, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	attempts := []execution.StepAttemptProjection{}
	prefix := strings.TrimSpace(requestID) + "\x00"
	for key, attempt := range s.stepAttempts {
		if strings.HasPrefix(key, prefix) {
			attempts = append(attempts, execution.CloneStepAttemptProjection(attempt))
		}
	}
	sort.Slice(attempts, func(left int, right int) bool {
		if attempts[left].StartedAt.Equal(attempts[right].StartedAt) {
			return attempts[left].AttemptID < attempts[right].AttemptID
		}
		return attempts[left].StartedAt.Before(attempts[right].StartedAt)
	})
	return attempts, nil
}

func (s *InMemoryRunProjectionStore) ListStepResults(
	_ context.Context,
	requestID string,
) ([]execution.StepResultProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[requestID]; !exists {
		return nil, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	results := []execution.StepResultProjection{}
	prefix := strings.TrimSpace(requestID) + "\x00"
	for key, result := range s.stepResults {
		if strings.HasPrefix(key, prefix) {
			results = append(results, execution.CloneStepResultProjection(result))
		}
	}
	sort.Slice(results, func(left int, right int) bool {
		if results[left].CreatedAt.Equal(results[right].CreatedAt) {
			return results[left].ResultID < results[right].ResultID
		}
		return results[left].CreatedAt.Before(results[right].CreatedAt)
	})
	return results, nil
}
