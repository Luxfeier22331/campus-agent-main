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
	requestID string,
	allowSuperseded bool,
) error {
	if !activity.IsActivity(ctx) {
		return nil
	}
	if s == nil || s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	intent, err := s.runProjectionStore.GetWorkflowStartIntent(ctx, strings.TrimSpace(requestID))
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
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.runProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("request %s is already terminal: %s", run.RequestID, run.Status)
	}
	return run, nil
}

func (s *Server) temporalActivityRunAllowCompletedAgentFinalization(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.runProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return run, nil
	}
	if temporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("request %s is already terminal: %s", run.RequestID, run.Status)
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
	summary := summarizeTemporalFailure(failureKind)
	operation := strings.TrimSpace(tool)
	if operation == "" {
		operation = "finalization.write"
	}
	err := s.projectTemporalFailureStep(ctx, run, temporalStepFailureProjection{
		Tool:            tool,
		FailureKind:     summary.Kind,
		ProjectionRef:   temporalProjectionRef(run.RequestID, "finalization/write"),
		ResultKind:      "activity_failure",
		StepID:          "finalization.write",
		StepKind:        "finalization",
		TaskQueue:       temporalruntime.ActivityTaskQueueCore,
		FailCloseReason: failCloseReason,
		Payload: map[string]any{
			"failure": map[string]any{
				"code":      summary.Kind,
				"operation": operation,
			},
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
	payload := temporalFailurePayload(projection)
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
	switch strings.TrimSpace(projection.FailureKind) {
	case "current_state_unverifiable",
		"agent_runtime_unauthorized",
		"source_conflict",
		"temporal_scope_ambiguous",
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
	summary := summarizeTemporalFailure(failureKind)
	failureKind = summary.Kind
	terminalError := temporalRunFailureErrorPayload(projection, failureKind)
	terminalReason := temporalFailureTerminalReason(projection, failureKind)
	if run.Status != execution.DurableRunStatusFailed {
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":activity-failed:" + failureKind,
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeActivityFailed,
			OccurredAt:           failedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"failure": temporalFailurePayload(projection)["failure"],
				"message": summary.Message,
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
				temporalRunFailureRetryable(projection, failureKind),
			),
		); err != nil {
			return execution.DurableRun{}, err
		}
	}
	failedRun, transitionErr := s.runProjectionStore.FailRunProjection(
		ctx,
		execution.DurableRunFailRequest{
			Now:             failedAt,
			RequestID:       run.RequestID,
			FailCloseReason: temporalFailureFailCloseReason(projection),
			TerminalReason:  terminalReason,
			TerminalEvent: execution.DurableRunEvent{
				EventID:              run.RequestID + ":run-failed",
				RequestID:            run.RequestID,
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
	case "agent_runtime_timeout",
		"provider_rate_limited",
		"provider_http_failed",
		"provider_connection_failed",
		"provider_timeout",
		"provider_unavailable":
		return execution.DurableTerminalReasonProviderUnavailable
	case "agent_deadline_exceeded", "workflow_execution_timeout":
		return execution.DurableTerminalReasonRunTimeout
	case "worker_unavailable":
		return execution.DurableTerminalReasonWorkerUnavailable
	case "agent_runtime_unauthorized",
		"agent_runtime_response_invalid",
		"admission_snapshot_invalid",
		"admission_snapshot_mismatch",
		"agent_invocation_envelope_invalid",
		"agent_runtime_incomplete",
		"agent_runtime_missing_final_output",
		"agent_runtime_not_configured",
		"agent_runtime_request_failed",
		"agent_runtime_result_invalid",
		"execution_input_metadata_invalid",
		"finalization_input_invalid",
		"finalization_replay_conflict",
		"finalization_replay_incomplete",
		"invalid_request",
		"invalid_model_target_sha256",
		"model_target_mismatch",
		"temporal_execution_binding_mismatch",
		"tool_contract_mismatch",
		"workflow_start_not_dispatched_invalid",
		"workflow_start_after_dispatch_invalid",
		"workflow_start_remote_identity_conflict",
		"workflow_completed_without_terminal_projection",
		"workflow_failed_without_terminal_projection",
		"workflow_canceled_without_terminal_projection",
		"workflow_terminated_without_terminal_projection",
		"workflow_successor_without_authorization":
		return execution.DurableTerminalReasonRuntimeInvariant
	default:
		return execution.DurableTerminalReasonExecutionFailed
	}
}

func temporalRunFailureRetryable(
	projection temporalStepFailureProjection,
	failureKind string,
) bool {
	if projection.TimeoutOutcome == execution.TimeoutOutcomeProviderTimeout ||
		projection.TimeoutOutcome == execution.TimeoutOutcomeActivityTimeout ||
		projection.TimeoutOutcome == execution.TimeoutOutcomeWorkflowTimeout {
		return true
	}
	switch strings.TrimSpace(failureKind) {
	case "agent_attempt_uncertain",
		"agent_deadline_exceeded",
		"agent_runtime_timeout",
		"execution_input_unavailable",
		"model_config_unavailable",
		"provider_rate_limited",
		"provider_http_failed",
		"provider_connection_failed",
		"provider_timeout",
		"provider_unavailable",
		"worker_unavailable",
		"workflow_execution_timeout":
		return true
	default:
		return false
	}
}

func temporalRunFailureErrorPayload(
	projection temporalStepFailureProjection,
	failureKind string,
) map[string]any {
	summary := summarizeTemporalFailure(failureKind)
	return map[string]any{
		"code":      summary.Kind,
		"message":   summary.Message,
		"retryable": temporalRunFailureRetryable(projection, failureKind),
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
		events, listErr := s.runProjectionStore.ListRunEvents(ctx, event.RequestID)
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
