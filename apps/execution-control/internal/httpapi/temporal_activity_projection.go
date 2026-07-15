package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func (s *Server) temporalActivityRun(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("run %s is already terminal: %s", run.RunID, run.Status)
	}
	return run, nil
}

func (s *Server) temporalActivityRunAllowCompletedAgentFinalization(
	ctx context.Context,
	runID string,
	traceID string,
	agentResultRef string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	if run.Status == execution.DurableRunStatusCompleted {
		if _, err := temporalAgentResultFromRun(run, agentResultRef); err != nil {
			return execution.DurableRun{}, err
		}
		return run, nil
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("run %s is already terminal: %s", run.RunID, run.Status)
	}
	return run, nil
}

func temporalRunTerminal(status execution.DurableRunStatus) bool {
	switch status {
	case execution.DurableRunStatusCompleted,
		execution.DurableRunStatusFailed,
		execution.DurableRunStatusCanceled,
		execution.DurableRunStatusExpired:
		return true
	default:
		return false
	}
}

func (s *Server) failFinalizationActivity(
	ctx context.Context,
	run execution.DurableRun,
	tool string,
	failureKind string,
	failCloseReason string,
	cause error,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		Tool:            tool,
		FailureKind:     failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "finalization/write"),
		ResultKind:      "activity_failure",
		StepID:          "finalization.write",
		StepKind:        "finalization",
		TaskQueue:       temporalruntime.ActivityTaskQueueCore,
		FailCloseReason: failCloseReason,
		Payload: map[string]any{
			"fail_close_reason": failCloseReason,
			"failure_kind":      failureKind,
			"message":           cause.Error(),
		},
	}, cause)
	return temporalruntime.WriteFinalizationActivityOutput{}, err
}

type temporalStepFailureProjection struct {
	Tool            string
	FailureKind     string
	CancelOutcome   execution.CancelOutcome
	FailCloseReason string
	Payload         map[string]any
	ProjectionRef   string
	ResultKind      string
	StepID          string
	StepKind        string
	TaskQueue       string
	TimeoutOutcome  execution.TimeoutOutcome
}

func (s *Server) failTemporalRunStep(
	ctx context.Context,
	run execution.DurableRun,
	projection temporalStepFailureProjection,
	cause error,
) (execution.DurableRun, error) {
	now := time.Now().UTC()
	payload := projection.Payload
	if payload == nil {
		payload = map[string]any{
			"failure_kind": projection.FailureKind,
			"message":      cause.Error(),
		}
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:         1,
		Tool:            temporalFailureTool(projection),
		CancelOutcome:   temporalFailureCancelOutcome(ctx, projection.CancelOutcome),
		FailCloseReason: temporalFailureFailCloseReason(projection),
		Run:             run,
		Status:          "failed",
		StepID:          projection.StepID,
		StepKind:        projection.StepKind,
		TaskQueue:       projection.TaskQueue,
		WorkerID:        s.config.TemporalWorkerIdentity,
		StartedAt:       now,
		CompletedAt:     now,
		UpdatedAt:       now,
		ResultKind:      projection.ResultKind,
		ProjectionRef:   projection.ProjectionRef,
		TimeoutOutcome:  temporalFailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause),
		Payload:         payload,
	}); err != nil {
		return execution.DurableRun{}, err
	}
	return s.failTemporalRun(ctx, run, projection, cause)
}

func temporalFailureTool(projection temporalStepFailureProjection) string {
	if tool := strings.TrimSpace(projection.Tool); tool != "" {
		return tool
	}
	return ""
}

func temporalFailureFailCloseReason(projection temporalStepFailureProjection) string {
	if strings.TrimSpace(projection.FailCloseReason) != "" {
		return strings.TrimSpace(projection.FailCloseReason)
	}
	if projection.Payload != nil {
		if value := strings.TrimSpace(stringValue(projection.Payload["fail_close_reason"])); value != "" {
			return value
		}
	}
	switch strings.TrimSpace(projection.FailureKind) {
	case "current_state_unverifiable",
		"source_conflict",
		"temporal_scope_ambiguous",
		"clarification_required",
		"not_found":
		return strings.TrimSpace(projection.FailureKind)
	default:
		return ""
	}
}

func temporalFailureCancelOutcome(
	ctx context.Context,
	configured execution.CancelOutcome,
) execution.CancelOutcome {
	if configured != "" {
		return configured
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return execution.CancelOutcomeActivityContextCanceled
	}
	return execution.CancelOutcomeNotRequested
}

func temporalFailureTimeoutOutcome(
	ctx context.Context,
	configured execution.TimeoutOutcome,
	cause error,
) execution.TimeoutOutcome {
	if configured != "" {
		return configured
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return execution.TimeoutOutcomeActivityTimeout
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return execution.TimeoutOutcomeActivityTimeout
	}
	return execution.TimeoutOutcomeNotTimedOut
}

func (s *Server) failTemporalRun(
	ctx context.Context,
	run execution.DurableRun,
	projection temporalStepFailureProjection,
	cause error,
) (execution.DurableRun, error) {
	failedAt := time.Now().UTC()
	failureKind := projection.FailureKind
	terminalError := temporalRunFailureErrorPayload(failureKind, cause)
	_, _ = s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-failed:" + failureKind,
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityFailed,
		OccurredAt:           failedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	})
	terminalReason := temporalFailureTerminalReason(projection, failureKind)
	failedRun, transitionErr := s.runProjectionStore.FailRunProjection(
		ctx,
		execution.DurableRunFailRequest{
			Now:            failedAt,
			RunID:          run.RunID,
			SelectedTool:   temporalFailureTool(projection),
			TerminalReason: terminalReason,
		},
	)
	if transitionErr != nil {
		return execution.DurableRun{}, transitionErr
	}
	_, _ = s.runProjectionStore.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":run-failed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunFailed,
		OccurredAt:           failedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"failure_kind":    failureKind,
			"request_id":      run.RequestID,
			"status":          string(execution.DurableRunStatusFailed),
			"terminal_reason": string(terminalReason),
			"trace_id":        run.TraceID,
			"error":           terminalError,
		},
	})
	return failedRun, nonRetryableTerminalProjectionError(failureKind, cause)
}

func temporalFailureTerminalReason(
	projection temporalStepFailureProjection,
	failureKind string,
) execution.DurableTerminalReason {
	if projection.TimeoutOutcome == execution.TimeoutOutcomeProviderTimeout {
		return execution.DurableTerminalReasonProviderUnavailable
	}
	if projection.TimeoutOutcome == execution.TimeoutOutcomeActivityTimeout {
		return execution.DurableTerminalReasonRunTimeout
	}
	switch strings.TrimSpace(failureKind) {
	case "agent_runtime_failed", "provider_profile_missing", "provider_unavailable":
		return execution.DurableTerminalReasonProviderUnavailable
	case "knowledge_search_failed", "retrieval_lookup_failed", "tool_execution_failed":
		return execution.DurableTerminalReasonRetrievalUnavailable
	default:
		return execution.DurableTerminalReasonWorkerUnavailable
	}
}

func nonRetryableTerminalProjectionError(failureKind string, cause error) error {
	message := "execution run failed"
	if cause != nil && strings.TrimSpace(cause.Error()) != "" {
		message = cause.Error()
	}
	errorType := strings.TrimSpace(failureKind)
	if errorType == "" {
		errorType = "execution_failed"
	}
	return temporal.NewNonRetryableApplicationError(message, errorType, cause)
}

func temporalRunFailureErrorPayload(failureKind string, cause error) map[string]any {
	code := strings.TrimSpace(failureKind)
	if code == "" {
		code = "execution_failed"
	}
	message := strings.TrimSpace(cause.Error())
	if code == "agent_runtime_timeout" {
		message = "Agent runtime request timed out."
	}
	if message == "" {
		message = "Execution run failed."
	}
	return map[string]any{
		"code":      code,
		"message":   message,
		"retryable": false,
	}
}

func temporalAgentResultFromRun(
	run execution.DurableRun,
	agentResultRef string,
) (map[string]any, error) {
	raw, ok := run.Metadata["temporal_agent"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("run metadata.temporal_agent is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["agent_result_ref"])) != agentResultRef {
		return nil, fmt.Errorf("agent result ref drift")
	}
	return raw, nil
}

func temporalProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func (s *Server) appendTemporalRunEvent(ctx context.Context, event execution.DurableRunEvent) error {
	if _, err := s.runProjectionStore.AppendRunEvent(ctx, event); err != nil {
		if !errors.Is(err, execution.ErrInvalidRunEvent) {
			return err
		}
		events, listErr := s.runProjectionStore.ListRunEvents(ctx, event.RunID)
		if listErr != nil {
			return err
		}
		for _, existing := range events {
			if existing.EventID != event.EventID {
				continue
			}
			if existing.EventType == event.EventType &&
				existing.ConversationID == event.ConversationID &&
				existing.PayloadSchemaVersion == event.PayloadSchemaVersion &&
				temporalEventPayloadEquivalent(existing.Payload, event.Payload) {
				return nil
			}
			return err
		}
		return err
	}
	return nil
}

func temporalEventPayloadEquivalent(left map[string]any, right map[string]any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	if leftErr == nil && rightErr == nil {
		return string(leftJSON) == string(rightJSON)
	}
	return reflect.DeepEqual(left, right)
}

func cloneTemporalMetadata(metadata map[string]any) map[string]any {
	cloned := make(map[string]any, len(metadata)+1)
	for key, value := range metadata {
		cloned[key] = value
	}
	return cloned
}

func cloneAnyMapFromMetadata(value any) map[string]any {
	source, ok := value.(map[string]any)
	if !ok || source == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(source)+1)
	for key, item := range source {
		cloned[key] = item
	}
	return cloned
}
