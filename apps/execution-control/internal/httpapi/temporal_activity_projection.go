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
	"go.temporal.io/sdk/activity"
)

func (s *Server) ensureTemporalActivityOwnsRootExecution(
	ctx context.Context,
	runID string,
	allowSuperseded bool,
) error {
	if !activity.IsActivity(ctx) {
		return nil
	}
	if s == nil || s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	intent, err := s.runProjectionStore.GetWorkflowStartIntent(ctx, strings.TrimSpace(runID))
	if err != nil {
		return sanitizedTemporalApplicationError(
			"temporal_execution_binding_unavailable",
			err,
			false,
		)
	}
	info := activity.GetInfo(ctx)
	workflowID := strings.TrimSpace(info.WorkflowExecution.ID)
	temporalRunID := strings.TrimSpace(info.WorkflowExecution.RunID)
	if workflowID == "" || temporalRunID == "" || strings.TrimSpace(intent.WorkflowID) != workflowID {
		return sanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity workflow execution does not match its durable workflow identity"),
			true,
		)
	}
	boundRunID := strings.TrimSpace(intent.TemporalRunID)
	if boundRunID == "" {
		return sanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable root Temporal Run ID is not confirmed yet"),
			false,
		)
	}
	if boundRunID != temporalRunID {
		return sanitizedTemporalApplicationError(
			"temporal_execution_binding_mismatch",
			errors.New("activity Temporal Run ID is not the durable root execution"),
			true,
		)
	}
	if intent.State == execution.LifecycleIntentStateSuperseded && !allowSuperseded {
		return sanitizedTemporalApplicationError(
			"temporal_execution_cancellation_pending",
			errors.New("durable workflow execution was superseded by cancellation"),
			false,
		)
	}
	if intent.State != execution.LifecycleIntentStateConfirmed &&
		(!allowSuperseded || intent.State != execution.LifecycleIntentStateSuperseded) {
		return sanitizedTemporalApplicationError(
			"temporal_execution_binding_pending",
			errors.New("durable workflow execution binding is not active"),
			false,
		)
	}
	return nil
}

func (s *Server) temporalActivityRun(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, runID, false); err != nil {
		return execution.DurableRun{}, err
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
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, runID, false); err != nil {
		return execution.DurableRun{}, err
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
	summary := summarizeTemporalFailure(failureKind, "", cause)
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		Tool:            tool,
		FailureHash:     summary.Hash,
		FailureKind:     summary.Kind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "finalization/write"),
		ResultKind:      "activity_failure",
		StepID:          "finalization.write",
		StepKind:        "finalization",
		TaskQueue:       temporalruntime.ActivityTaskQueueCore,
		FailCloseReason: failCloseReason,
		Payload: map[string]any{
			"fail_close_reason": failCloseReason,
		},
	}, cause)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.WriteFinalizationActivityOutput{}, temporalApplicationError(summary, true)
}

type temporalStepFailureProjection struct {
	Tool               string
	FailedAt           time.Time
	FailureHash        string
	FailureKind        string
	CancelOutcome      execution.CancelOutcome
	FailCloseReason    string
	ModelName          string
	ModelProvider      string
	ModelRequestCount  int64
	InputTokens        int64
	OutputTokens       int64
	CachedInputTokens  int64
	UsageObserved      bool
	ProviderResponseID string
	Payload            map[string]any
	ProjectionRef      string
	ResultKind         string
	StepID             string
	StepKind           string
	TaskQueue          string
	TimeoutOutcome     execution.TimeoutOutcome
}

func (s *Server) projectTemporalFailureStep(
	ctx context.Context,
	run execution.DurableRun,
	projection temporalStepFailureProjection,
	cause error,
) error {
	now := projection.FailedAt.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	projection.FailureKind = boundedTemporalFailureKind(projection.FailureKind)
	payload := temporalFailurePayload(projection, cause)
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:            1,
		Tool:               temporalFailureTool(projection),
		CancelOutcome:      temporalFailureCancelOutcome(ctx, projection.CancelOutcome),
		FailCloseReason:    temporalFailureFailCloseReason(projection),
		ModelName:          projection.ModelName,
		ModelProvider:      projection.ModelProvider,
		ModelRequestCount:  projection.ModelRequestCount,
		InputTokens:        projection.InputTokens,
		OutputTokens:       projection.OutputTokens,
		CachedInputTokens:  projection.CachedInputTokens,
		UsageObserved:      projection.UsageObserved,
		ProviderResponseID: projection.ProviderResponseID,
		Run:                run,
		Status:             "failed",
		StepID:             projection.StepID,
		StepKind:           projection.StepKind,
		TaskQueue:          projection.TaskQueue,
		WorkerID:           s.config.TemporalWorkerIdentity,
		StartedAt:          now,
		CompletedAt:        now,
		UpdatedAt:          now,
		ResultKind:         projection.ResultKind,
		ProjectionRef:      projection.ProjectionRef,
		TimeoutOutcome:     temporalFailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause),
		Payload:            payload,
	}); err != nil {
		return err
	}
	return nil
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
		"agent_runtime_unauthorized",
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
	failedAt := projection.FailedAt
	if failedAt.IsZero() {
		failedAt = time.Now().UTC()
	}
	failedAt = failedAt.UTC()
	failureKind := projection.FailureKind
	summary := summarizeTemporalFailure(failureKind, projection.FailureHash, cause)
	failureKind = summary.Kind
	terminalError := temporalRunFailureErrorPayload(failureKind, projection.FailureHash, cause)
	terminalReason := temporalFailureTerminalReason(projection, failureKind)
	if run.Status != execution.DurableRunStatusFailed {
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RunID + ":activity-failed:" + failureKind,
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeActivityFailed,
			OccurredAt:           failedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"failure_hash": summary.Hash,
				"failure_kind": summary.Kind,
				"message":      summary.Message,
			},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		writeProductFinalization := s.productFinalizationWriter
		if writeProductFinalization == nil {
			writeProductFinalization = s.writeChatProductFinalization
		}
		if err := writeProductFinalization(
			ctx,
			run,
			failedAt,
			productTerminalErrorResponse(
				run,
				"error",
				stringValue(terminalError["code"]),
				stringValue(terminalError["message"]),
				false,
			),
		); err != nil {
			return execution.DurableRun{}, err
		}
	}
	failedRun, transitionErr := s.runProjectionStore.FailRunProjection(
		ctx,
		execution.DurableRunFailRequest{
			Now:             failedAt,
			RunID:           run.RunID,
			FailCloseReason: temporalFailureFailCloseReason(projection),
			TerminalReason:  terminalReason,
			TerminalEvent: execution.DurableRunEvent{
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
			},
		},
	)
	if transitionErr != nil {
		return execution.DurableRun{}, transitionErr
	}
	return failedRun, nil
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
	if projection.TimeoutOutcome == execution.TimeoutOutcomeWorkflowTimeout {
		return execution.DurableTerminalReasonRunTimeout
	}
	switch strings.TrimSpace(failureKind) {
	case "agent_runtime_failed", "personal_memory_not_configured", "provider_config_missing", "provider_unavailable":
		return execution.DurableTerminalReasonProviderUnavailable
	case "retrieval_lookup_failed", "tool_execution_failed":
		return execution.DurableTerminalReasonRetrievalUnavailable
	case "workflow_completed_without_terminal_projection",
		"workflow_failed_without_terminal_projection",
		"workflow_canceled_without_terminal_projection",
		"workflow_terminated_without_terminal_projection",
		"agent_runtime_unauthorized",
		workflowUnauthorizedSuccessorFailure:
		return execution.DurableTerminalReasonRuntimeInvariant
	default:
		return execution.DurableTerminalReasonWorkerUnavailable
	}
}

func temporalRunFailureErrorPayload(failureKind string, failureHash string, cause error) map[string]any {
	summary := summarizeTemporalFailure(failureKind, failureHash, cause)
	return map[string]any{
		"code":         summary.Kind,
		"failure_hash": summary.Hash,
		"message":      summary.Message,
		"retryable":    false,
	}
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
