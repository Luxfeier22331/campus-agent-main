package execution

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"time"
)

func JSONMapToBytes(value map[string]any) ([]byte, error) {
	if value == nil {
		value = map[string]any{}
	}
	return json.Marshal(value)
}

func RunStepProjectionUpdateAllowed(current RunStepProjection, incoming RunStepProjection) bool {
	if current.ActivityAttempt > 0 &&
		(incoming.ActivityAttempt == 0 || incoming.ActivityAttempt < current.ActivityAttempt) {
		return false
	}
	if current.ActivityAttempt == incoming.ActivityAttempt && StepProjectionStatusTerminal(current.Status) {
		return RunStepProjectionEquivalent(current, incoming)
	}
	return true
}

func StepAttemptProjectionUpdateAllowed(current StepAttemptProjection, incoming StepAttemptProjection) bool {
	if current.RequestID != incoming.RequestID ||
		current.StepID != incoming.StepID ||
		current.AttemptID != incoming.AttemptID ||
		current.Attempt != incoming.Attempt ||
		(StepProjectionStatusTerminal(current.Status) && !StepAttemptProjectionEquivalent(current, incoming)) {
		return false
	}
	return current.ActivityAttempt == 0 || incoming.ActivityAttempt >= current.ActivityAttempt
}

func RunStepProjectionEquivalent(left RunStepProjection, right RunStepProjection) bool {
	return left.StepID == right.StepID && left.RequestID == right.RequestID &&
		left.ConversationID == right.ConversationID && left.StepKind == right.StepKind &&
		left.Tool == right.Tool && left.ParentStepID == right.ParentStepID &&
		left.Status == right.Status && left.ActivityAttempt == right.ActivityAttempt &&
		left.TaskQueue == right.TaskQueue && left.WorkerID == right.WorkerID &&
		left.StartedAt.Equal(right.StartedAt) && left.CompletedAt.Equal(right.CompletedAt) &&
		left.UpdatedAt.Equal(right.UpdatedAt) && left.PayloadSchemaVersion == right.PayloadSchemaVersion &&
		JSONMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func StepAttemptProjectionEquivalent(left StepAttemptProjection, right StepAttemptProjection) bool {
	return left.AttemptID == right.AttemptID && left.StepID == right.StepID && left.RequestID == right.RequestID &&
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
		JSONMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func JSONMapsEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := JSONMapToBytes(left)
	rightJSON, rightErr := JSONMapToBytes(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftJSON, rightJSON)
}

func StepProjectionStatusTerminal(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "failed", "blocked", "canceled", "expired", "skipped":
		return true
	default:
		return false
	}
}

func ProjectionActivityAttempt(attempt StepAttemptProjection) int {
	if attempt.ActivityAttempt > 0 {
		return attempt.ActivityAttempt
	}
	return attempt.Attempt
}

func StepResultProjectionWriteAllowed(status DurableRunStatus, result StepResultProjection) bool {
	if durableRunStatusIsActive(status) {
		return true
	}
	if status != DurableRunStatusCompleted {
		return false
	}
	return result.StepID == "memory.append" && result.ResultKind == "memory_conversation_append_result"
}

func ValidateRunStepProjection(step RunStepProjection) error {
	switch {
	case strings.TrimSpace(step.RequestID) == "":
		return fmt.Errorf("%w: request_id is required", ErrInvalidRunStep)
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

func ValidateStepAttemptProjection(attempt StepAttemptProjection) error {
	switch {
	case strings.TrimSpace(attempt.RequestID) == "":
		return fmt.Errorf("%w: request_id is required", ErrInvalidStepAttempt)
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
	if attempt.ActivityAttempt < 0 || attempt.ScheduleToStartMS < 0 || attempt.DurationMS < 0 || attempt.ModelRequestCount < 0 ||
		attempt.InputTokens < 0 || attempt.OutputTokens < 0 || attempt.CachedInputTokens < 0 {
		return fmt.Errorf("%w: numeric fields must be non-negative", ErrInvalidStepAttempt)
	}
	if err := ValidateCancelOutcome(attempt.CancelOutcome); err != nil {
		return err
	}
	if err := ValidateTimeoutOutcome(attempt.TimeoutOutcome); err != nil {
		return err
	}
	return ValidateLateCompletionOutcome(attempt.LateCompletionOutcome)
}

func ValidateCancelOutcome(value CancelOutcome) error {
	switch value {
	case "", CancelOutcomeNotRequested, CancelOutcomeRequestedBeforeStart, CancelOutcomeActivityContextCanceled,
		CancelOutcomeDelivered, CancelOutcomeProviderConnectionAborted, CancelOutcomeProviderBackgroundCancelled,
		CancelOutcomeCompletedBeforeCancel, CancelOutcomeAbortUnproven:
		return nil
	default:
		return fmt.Errorf("%w: unsupported cancel_outcome %q", ErrInvalidStepAttempt, value)
	}
}

func ValidateTimeoutOutcome(value TimeoutOutcome) error {
	switch value {
	case "", TimeoutOutcomeNotTimedOut, TimeoutOutcomeActivityTimeout, TimeoutOutcomeProviderTimeout, TimeoutOutcomeWorkflowTimeout:
		return nil
	default:
		return fmt.Errorf("%w: unsupported timeout_outcome %q", ErrInvalidStepAttempt, value)
	}
}

func ValidateLateCompletionOutcome(value LateCompletionOutcome) error {
	switch value {
	case "", LateCompletionOutcomeNotLate, LateCompletionOutcomeIgnoredAfterCancel, LateCompletionOutcomeIgnoredAfterTimeout,
		LateCompletionOutcomeIgnoredAfterTerminalProjection, LateCompletionOutcomeAcceptedBeforeTerminalProjection:
		return nil
	default:
		return fmt.Errorf("%w: unsupported late_completion_outcome %q", ErrInvalidStepAttempt, value)
	}
}

func ValidateStepResultProjection(result StepResultProjection) error {
	switch {
	case strings.TrimSpace(result.RequestID) == "":
		return fmt.Errorf("%w: request_id is required", ErrInvalidStepResult)
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

func CanonicalStepResultProjection(result StepResultProjection) (StepResultProjection, error) {
	result.CreatedAt = result.CreatedAt.UTC().Truncate(time.Microsecond)
	if _, err := JSONMapToBytes(result.SanitizedPayload); err != nil {
		return StepResultProjection{}, fmt.Errorf("%w: sanitized_payload must be valid JSON: %v", ErrInvalidStepResult, err)
	}
	return result, nil
}

func StepResultProjectionEquivalent(left StepResultProjection, right StepResultProjection) bool {
	return StepResultProjectionFieldsEquivalent(left, right) && JSONMapsEquivalent(left.SanitizedPayload, right.SanitizedPayload)
}

func StepResultProjectionFieldsEquivalent(left StepResultProjection, right StepResultProjection) bool {
	return left.ResultID == right.ResultID && left.StepID == right.StepID && left.RequestID == right.RequestID &&
		left.AttemptID == right.AttemptID && left.Status == right.Status && left.ResultKind == right.ResultKind &&
		left.ProjectionRef == right.ProjectionRef && left.CreatedAt.Equal(right.CreatedAt) &&
		left.PayloadSchemaVersion == right.PayloadSchemaVersion
}

func RunStepKey(requestID string, stepID string) string {
	return strings.TrimSpace(requestID) + "\x00" + strings.TrimSpace(stepID)
}
func StepAttemptKey(requestID string, attemptID string) string {
	return strings.TrimSpace(requestID) + "\x00" + strings.TrimSpace(attemptID)
}
func StepResultKey(requestID string, resultID string) string {
	return strings.TrimSpace(requestID) + "\x00" + strings.TrimSpace(resultID)
}

func CloneRunStepProjection(step RunStepProjection) RunStepProjection {
	step.SanitizedPayload = cloneAnyMap(step.SanitizedPayload)
	return step
}
func CloneStepAttemptProjection(attempt StepAttemptProjection) StepAttemptProjection {
	attempt.SanitizedPayload = cloneAnyMap(attempt.SanitizedPayload)
	return attempt
}
func CloneStepResultProjection(result StepResultProjection) StepResultProjection {
	result.SanitizedPayload = CloneStepResultJSONMap(result.SanitizedPayload)
	return result
}
func CloneStepResultJSONMap(source map[string]any) map[string]any {
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
			result.SetMapIndex(cloneStepResultJSONReflect(iterator.Key()), cloneStepResultJSONReflect(iterator.Value()))
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
