package execution

import (
	"bytes"
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) UpsertRunStep(
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
	key := runStepKey(step.RunID, step.StepID)
	if current, exists := s.runSteps[key]; exists && !runStepProjectionUpdateAllowed(current, step) {
		return cloneRunStepProjection(current), fmt.Errorf(
			"%w: run=%s step=%s status=%s activity_attempt=%d current_status=%s current_activity_attempt=%d",
			ErrStaleRunStepProjection,
			step.RunID,
			step.StepID,
			step.Status,
			step.ActivityAttempt,
			current.Status,
			current.ActivityAttempt,
		)
	}
	s.runSteps[key] = cloneRunStepProjection(step)
	return cloneRunStepProjection(step), nil
}

func (s *InMemoryRunProjectionStore) UpsertStepAttempt(
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
	for _, current := range s.stepAttempts {
		if current.AttemptID == attempt.AttemptID &&
			(current.RunID != attempt.RunID || current.StepID != attempt.StepID) {
			return StepAttemptProjection{}, fmt.Errorf(
				"%w: attempt_id=%s is already bound to run=%s step=%s",
				ErrStaleStepAttemptProjection,
				attempt.AttemptID,
				current.RunID,
				current.StepID,
			)
		}
		if current.RunID == attempt.RunID && current.StepID == attempt.StepID &&
			current.Attempt == attempt.Attempt && current.AttemptID != attempt.AttemptID {
			return StepAttemptProjection{}, fmt.Errorf(
				"%w: run=%s step=%s attempt=%d is already bound to attempt_id=%s",
				ErrStaleStepAttemptProjection,
				attempt.RunID,
				attempt.StepID,
				attempt.Attempt,
				current.AttemptID,
			)
		}
	}
	key := stepAttemptKey(attempt.RunID, attempt.AttemptID)
	if current, exists := s.stepAttempts[key]; exists && !stepAttemptProjectionUpdateAllowed(current, attempt) {
		return cloneStepAttemptProjection(current), fmt.Errorf(
			"%w: run=%s step=%s attempt_id=%s status=%s activity_attempt=%d current_status=%s current_activity_attempt=%d",
			ErrStaleStepAttemptProjection,
			attempt.RunID,
			attempt.StepID,
			attempt.AttemptID,
			attempt.Status,
			attempt.ActivityAttempt,
			current.Status,
			current.ActivityAttempt,
		)
	}
	s.stepAttempts[key] = cloneStepAttemptProjection(attempt)
	return cloneStepAttemptProjection(attempt), nil
}

func runStepProjectionUpdateAllowed(current RunStepProjection, incoming RunStepProjection) bool {
	if current.ActivityAttempt > 0 &&
		(incoming.ActivityAttempt == 0 || incoming.ActivityAttempt < current.ActivityAttempt) {
		return false
	}
	if current.ActivityAttempt == incoming.ActivityAttempt && stepProjectionStatusTerminal(current.Status) {
		return runStepProjectionEquivalent(current, incoming)
	}
	return true
}

func stepAttemptProjectionUpdateAllowed(current StepAttemptProjection, incoming StepAttemptProjection) bool {
	if current.RunID != incoming.RunID ||
		current.StepID != incoming.StepID ||
		current.AttemptID != incoming.AttemptID ||
		current.Attempt != incoming.Attempt ||
		(stepProjectionStatusTerminal(current.Status) && !stepAttemptProjectionEquivalent(current, incoming)) {
		return false
	}
	return current.ActivityAttempt == 0 ||
		incoming.ActivityAttempt >= current.ActivityAttempt
}

func runStepProjectionEquivalent(left RunStepProjection, right RunStepProjection) bool {
	return left.StepID == right.StepID && left.RunID == right.RunID &&
		left.ConversationID == right.ConversationID && left.StepKind == right.StepKind &&
		left.Tool == right.Tool && left.ParentStepID == right.ParentStepID &&
		left.Status == right.Status && left.ActivityAttempt == right.ActivityAttempt &&
		left.TaskQueue == right.TaskQueue && left.WorkerID == right.WorkerID &&
		left.StartedAt.Equal(right.StartedAt) && left.CompletedAt.Equal(right.CompletedAt) &&
		left.UpdatedAt.Equal(right.UpdatedAt) && left.PayloadSchemaVersion == right.PayloadSchemaVersion &&
		jsonMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func stepAttemptProjectionEquivalent(left StepAttemptProjection, right StepAttemptProjection) bool {
	return left.AttemptID == right.AttemptID && left.StepID == right.StepID && left.RunID == right.RunID &&
		left.Attempt == right.Attempt && left.Status == right.Status && left.TaskQueue == right.TaskQueue &&
		left.WorkerID == right.WorkerID && left.WorkflowID == right.WorkflowID &&
		left.TemporalRunID == right.TemporalRunID && left.ActivityID == right.ActivityID &&
		left.ActivityType == right.ActivityType && left.ActivityAttempt == right.ActivityAttempt &&
		left.ScheduledAt.Equal(right.ScheduledAt) && left.StartedAt.Equal(right.StartedAt) &&
		left.CompletedAt.Equal(right.CompletedAt) && left.ScheduleToStartMS == right.ScheduleToStartMS &&
		left.DurationMS == right.DurationMS && left.ProviderRequestRef == right.ProviderRequestRef &&
		left.ProviderResponseID == right.ProviderResponseID && left.ModelProvider == right.ModelProvider &&
		left.ModelName == right.ModelName && left.InputTokens == right.InputTokens &&
		left.OutputTokens == right.OutputTokens && left.CachedInputTokens == right.CachedInputTokens &&
		left.CancelOutcome == right.CancelOutcome && left.TimeoutOutcome == right.TimeoutOutcome &&
		left.LateCompletionOutcome == right.LateCompletionOutcome &&
		left.FailCloseReason == right.FailCloseReason && left.TerminalReason == right.TerminalReason &&
		left.UpdatedAt.Equal(right.UpdatedAt) && left.PayloadSchemaVersion == right.PayloadSchemaVersion &&
		jsonMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func jsonMapsEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := jsonMapToBytes(left)
	rightJSON, rightErr := jsonMapToBytes(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}

func stepProjectionStatusTerminal(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "blocked", "canceled", "expired", "skipped":
		return true
	default:
		return false
	}
}

func (s *InMemoryRunProjectionStore) UpsertStepResult(
	_ context.Context,
	result StepResultProjection,
) (StepResultProjection, error) {
	if err := validateStepResultProjection(result); err != nil {
		return StepResultProjection{}, err
	}
	var err error
	result, err = canonicalStepResultProjection(result)
	if err != nil {
		return StepResultProjection{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[result.RunID]
	if !exists {
		return StepResultProjection{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, result.RunID)
	}
	if !stepResultProjectionWriteAllowed(run.Status, result) {
		return StepResultProjection{}, fmt.Errorf(
			"%w: run=%s status=%s",
			ErrDurableRunTerminalConflict,
			result.RunID,
			run.Status,
		)
	}
	for _, current := range s.stepResults {
		if current.ResultID == result.ResultID &&
			(current.RunID != result.RunID || current.StepID != result.StepID) {
			return StepResultProjection{}, fmt.Errorf(
				"%w: result_id=%s is already bound to run=%s step=%s",
				ErrStepResultProjectionConflict,
				result.ResultID,
				current.RunID,
				current.StepID,
			)
		}
	}
	key := stepResultKey(result.RunID, result.ResultID)
	if current, exists := s.stepResults[key]; exists {
		if stepResultProjectionEquivalent(current, result) {
			return cloneStepResultProjection(current), nil
		}
		return cloneStepResultProjection(current), fmt.Errorf(
			"%w: run=%s result=%s",
			ErrStepResultProjectionConflict,
			result.RunID,
			result.ResultID,
		)
	}
	s.stepResults[key] = cloneStepResultProjection(result)
	return cloneStepResultProjection(result), nil
}

func canonicalStepResultProjection(result StepResultProjection) (StepResultProjection, error) {
	result.CreatedAt = result.CreatedAt.UTC().Truncate(time.Microsecond)
	if _, err := jsonMapToBytes(result.SanitizedPayload); err != nil {
		return StepResultProjection{}, fmt.Errorf(
			"%w: sanitized_payload must be valid JSON: %v",
			ErrInvalidStepResult,
			err,
		)
	}
	return result, nil
}

func stepResultProjectionEquivalent(left StepResultProjection, right StepResultProjection) bool {
	return stepResultProjectionFieldsEquivalent(left, right) &&
		jsonMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func stepResultProjectionFieldsEquivalent(left StepResultProjection, right StepResultProjection) bool {
	return left.ResultID == right.ResultID && left.StepID == right.StepID && left.RunID == right.RunID &&
		left.AttemptID == right.AttemptID && left.Status == right.Status &&
		left.ResultKind == right.ResultKind && left.ProjectionRef == right.ProjectionRef &&
		left.CreatedAt.Equal(right.CreatedAt) && left.PayloadSchemaVersion == right.PayloadSchemaVersion
}

func stepResultProjectionWriteAllowed(status DurableRunStatus, result StepResultProjection) bool {
	if durableRunStatusIsActive(status) {
		return true
	}
	if status != DurableRunStatusCompleted {
		return false
	}
	// Product finalization completes the run before this non-critical memory stage.
	return result.StepID == "memory.append" && result.ResultKind == "memory_conversation_append_result"
}

func (s *InMemoryRunProjectionStore) ListRunSteps(
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

func (s *InMemoryRunProjectionStore) ListStepAttempts(
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

func (s *InMemoryRunProjectionStore) ListStepResults(
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
	case step.ActivityAttempt < 0:
		return fmt.Errorf("%w: activity_attempt must be non-negative", ErrInvalidRunStep)
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
	if attempt.ActivityAttempt < 0 {
		return fmt.Errorf("%w: activity_attempt must be non-negative", ErrInvalidStepAttempt)
	}
	if attempt.ScheduleToStartMS < 0 {
		return fmt.Errorf("%w: schedule_to_start_ms must be non-negative", ErrInvalidStepAttempt)
	}
	if attempt.DurationMS < 0 {
		return fmt.Errorf("%w: duration_ms must be non-negative", ErrInvalidStepAttempt)
	}
	if attempt.ModelRequestCount < 0 {
		return fmt.Errorf("%w: model_request_count must be non-negative", ErrInvalidStepAttempt)
	}
	if attempt.InputTokens < 0 ||
		attempt.OutputTokens < 0 ||
		attempt.CachedInputTokens < 0 {
		return fmt.Errorf("%w: token fields must be non-negative", ErrInvalidStepAttempt)
	}
	if err := validateCancelOutcome(attempt.CancelOutcome); err != nil {
		return err
	}
	if err := validateTimeoutOutcome(attempt.TimeoutOutcome); err != nil {
		return err
	}
	if err := validateLateCompletionOutcome(attempt.LateCompletionOutcome); err != nil {
		return err
	}
	return nil
}

func validateCancelOutcome(value CancelOutcome) error {
	switch value {
	case "",
		CancelOutcomeNotRequested,
		CancelOutcomeRequestedBeforeStart,
		CancelOutcomeActivityContextCanceled,
		CancelOutcomeDelivered,
		CancelOutcomeProviderConnectionAborted,
		CancelOutcomeProviderBackgroundCancelled,
		CancelOutcomeCompletedBeforeCancel,
		CancelOutcomeAbortUnproven:
		return nil
	default:
		return fmt.Errorf("%w: unsupported cancel_outcome %q", ErrInvalidStepAttempt, value)
	}
}

func validateTimeoutOutcome(value TimeoutOutcome) error {
	switch value {
	case "",
		TimeoutOutcomeNotTimedOut,
		TimeoutOutcomeActivityTimeout,
		TimeoutOutcomeProviderTimeout,
		TimeoutOutcomeWorkflowTimeout:
		return nil
	default:
		return fmt.Errorf("%w: unsupported timeout_outcome %q", ErrInvalidStepAttempt, value)
	}
}

func validateLateCompletionOutcome(value LateCompletionOutcome) error {
	switch value {
	case "",
		LateCompletionOutcomeNotLate,
		LateCompletionOutcomeIgnoredAfterCancel,
		LateCompletionOutcomeIgnoredAfterTimeout,
		LateCompletionOutcomeIgnoredAfterTerminalProjection,
		LateCompletionOutcomeAcceptedBeforeTerminalProjection:
		return nil
	default:
		return fmt.Errorf("%w: unsupported late_completion_outcome %q", ErrInvalidStepAttempt, value)
	}
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
	result.SanitizedPayload = cloneStepResultJSONMap(result.SanitizedPayload)
	return result
}

func cloneStepResultJSONMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	return cloneStepResultJSONReflect(reflect.ValueOf(source)).Interface().(map[string]any)
}

func cloneStepResultJSONReflect(value reflect.Value) reflect.Value {
	if !value.IsValid() {
		return value
	}
	switch value.Kind() {
	case reflect.Interface:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		result := reflect.New(value.Type()).Elem()
		result.Set(cloneStepResultJSONReflect(value.Elem()))
		return result
	case reflect.Pointer:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		result := reflect.New(value.Type().Elem())
		result.Elem().Set(cloneStepResultJSONReflect(value.Elem()))
		return result
	case reflect.Map:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		result := reflect.MakeMapWithSize(value.Type(), value.Len())
		iterator := value.MapRange()
		for iterator.Next() {
			result.SetMapIndex(
				cloneStepResultJSONReflect(iterator.Key()),
				cloneStepResultJSONReflect(iterator.Value()),
			)
		}
		return result
	case reflect.Slice:
		if value.IsNil() {
			return reflect.Zero(value.Type())
		}
		result := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
		for index := range value.Len() {
			result.Index(index).Set(cloneStepResultJSONReflect(value.Index(index)))
		}
		return result
	case reflect.Array:
		result := reflect.New(value.Type()).Elem()
		for index := range value.Len() {
			result.Index(index).Set(cloneStepResultJSONReflect(value.Index(index)))
		}
		return result
	case reflect.Struct:
		for index := range value.NumField() {
			if value.Type().Field(index).PkgPath != "" {
				return value
			}
		}
		result := reflect.New(value.Type()).Elem()
		for index := range value.NumField() {
			result.Field(index).Set(cloneStepResultJSONReflect(value.Field(index)))
		}
		return result
	default:
		return value
	}
}
