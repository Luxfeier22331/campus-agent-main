package execution

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

func (s *InMemoryDurableRuntimeStore) UpsertRunStep(
	_ context.Context,
	step RunStepProjection,
) (RunStepProjection, error) {
	if err := validateRunStepProjection(step); err != nil {
		return RunStepProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[step.RunID]; !exists {
		return RunStepProjection{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, step.RunID)
	}
	s.runSteps[runStepKey(step.RunID, step.StepID)] = cloneRunStepProjection(step)
	return cloneRunStepProjection(step), nil
}

func (s *InMemoryDurableRuntimeStore) UpsertStepAttempt(
	_ context.Context,
	attempt StepAttemptProjection,
) (StepAttemptProjection, error) {
	if err := validateStepAttemptProjection(attempt); err != nil {
		return StepAttemptProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[attempt.RunID]; !exists {
		return StepAttemptProjection{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, attempt.RunID)
	}
	s.stepAttempts[stepAttemptKey(attempt.RunID, attempt.AttemptID)] = cloneStepAttemptProjection(attempt)
	return cloneStepAttemptProjection(attempt), nil
}

func (s *InMemoryDurableRuntimeStore) UpsertStepResult(
	_ context.Context,
	result StepResultProjection,
) (StepResultProjection, error) {
	if err := validateStepResultProjection(result); err != nil {
		return StepResultProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[result.RunID]; !exists {
		return StepResultProjection{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
	}
	s.stepResults[stepResultKey(result.RunID, result.ResultID)] = cloneStepResultProjection(result)
	return cloneStepResultProjection(result), nil
}

func (s *InMemoryDurableRuntimeStore) ListRunSteps(
	_ context.Context,
	runID string,
) ([]RunStepProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[runID]; !exists {
		return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	steps := []RunStepProjection{}
	prefix := strings.TrimSpace(runID) + "\x00"
	for key, step := range s.runSteps {
		if strings.HasPrefix(key, prefix) {
			steps = append(steps, cloneRunStepProjection(step))
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

func (s *InMemoryDurableRuntimeStore) ListStepAttempts(
	_ context.Context,
	runID string,
) ([]StepAttemptProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[runID]; !exists {
		return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	attempts := []StepAttemptProjection{}
	prefix := strings.TrimSpace(runID) + "\x00"
	for key, attempt := range s.stepAttempts {
		if strings.HasPrefix(key, prefix) {
			attempts = append(attempts, cloneStepAttemptProjection(attempt))
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

func (s *InMemoryDurableRuntimeStore) ListStepResults(
	_ context.Context,
	runID string,
) ([]StepResultProjection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[runID]; !exists {
		return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	results := []StepResultProjection{}
	prefix := strings.TrimSpace(runID) + "\x00"
	for key, result := range s.stepResults {
		if strings.HasPrefix(key, prefix) {
			results = append(results, cloneStepResultProjection(result))
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

func validateRunStepProjection(step RunStepProjection) error {
	switch {
	case strings.TrimSpace(step.RunID) == "":
		return fmt.Errorf("%w: run_id is required", ErrInvalidRunStep)
	case strings.TrimSpace(step.StepID) == "":
		return fmt.Errorf("%w: step_id is required", ErrInvalidRunStep)
	case strings.TrimSpace(step.ConversationID) == "":
		return fmt.Errorf("%w: conversation_id is required", ErrInvalidRunStep)
	case strings.TrimSpace(step.StepKind) == "":
		return fmt.Errorf("%w: step_kind is required", ErrInvalidRunStep)
	case strings.TrimSpace(step.Status) == "":
		return fmt.Errorf("%w: status is required", ErrInvalidRunStep)
	case strings.TrimSpace(step.PayloadSchemaVersion) == "":
		return fmt.Errorf("%w: payload_schema_version is required", ErrInvalidRunStep)
	case step.UpdatedAt.IsZero():
		return fmt.Errorf("%w: updated_at is required", ErrInvalidRunStep)
	}
	return nil
}

func validateStepAttemptProjection(attempt StepAttemptProjection) error {
	switch {
	case strings.TrimSpace(attempt.RunID) == "":
		return fmt.Errorf("%w: run_id is required", ErrInvalidStepAttempt)
	case strings.TrimSpace(attempt.StepID) == "":
		return fmt.Errorf("%w: step_id is required", ErrInvalidStepAttempt)
	case strings.TrimSpace(attempt.AttemptID) == "":
		return fmt.Errorf("%w: attempt_id is required", ErrInvalidStepAttempt)
	case attempt.Attempt <= 0:
		return fmt.Errorf("%w: attempt must be positive", ErrInvalidStepAttempt)
	case strings.TrimSpace(attempt.Status) == "":
		return fmt.Errorf("%w: status is required", ErrInvalidStepAttempt)
	case strings.TrimSpace(attempt.PayloadSchemaVersion) == "":
		return fmt.Errorf("%w: payload_schema_version is required", ErrInvalidStepAttempt)
	case attempt.UpdatedAt.IsZero():
		return fmt.Errorf("%w: updated_at is required", ErrInvalidStepAttempt)
	}
	return nil
}

func validateStepResultProjection(result StepResultProjection) error {
	switch {
	case strings.TrimSpace(result.RunID) == "":
		return fmt.Errorf("%w: run_id is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.StepID) == "":
		return fmt.Errorf("%w: step_id is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.ResultID) == "":
		return fmt.Errorf("%w: result_id is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.Status) == "":
		return fmt.Errorf("%w: status is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.ResultKind) == "":
		return fmt.Errorf("%w: result_kind is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.ProjectionRef) == "":
		return fmt.Errorf("%w: projection_ref is required", ErrInvalidStepResult)
	case strings.TrimSpace(result.PayloadSchemaVersion) == "":
		return fmt.Errorf("%w: payload_schema_version is required", ErrInvalidStepResult)
	case result.CreatedAt.IsZero():
		return fmt.Errorf("%w: created_at is required", ErrInvalidStepResult)
	}
	return nil
}

func runStepKey(runID string, stepID string) string {
	return strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(stepID)
}

func stepAttemptKey(runID string, attemptID string) string {
	return strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(attemptID)
}

func stepResultKey(runID string, resultID string) string {
	return strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(resultID)
}

func cloneRunStepProjection(step RunStepProjection) RunStepProjection {
	step.SanitizedPayload = cloneAnyMap(step.SanitizedPayload)
	return step
}

func cloneStepAttemptProjection(attempt StepAttemptProjection) StepAttemptProjection {
	attempt.SanitizedPayload = cloneAnyMap(attempt.SanitizedPayload)
	return attempt
}

func cloneStepResultProjection(result StepResultProjection) StepResultProjection {
	result.SanitizedPayload = cloneAnyMap(result.SanitizedPayload)
	return result
}
