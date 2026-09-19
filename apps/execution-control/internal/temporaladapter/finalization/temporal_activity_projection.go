package finalization

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Adapter) TemporalActivityRunAllowCompletedWorkflowFinalization(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.RunProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.EnsureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.RunProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return run, nil
	}
	if activityprojection.TemporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("request %s is already terminal: %s", run.RequestID, run.Status)
	}
	return run, nil
}

func (s *Adapter) ValidateLocalToolContractFingerprintMap(expected map[string]any) error {
	if s == nil || s.AdmissionService == nil {
		return errors.New("agent admission service is not configured")
	}
	return s.AdmissionService.ValidateLocalToolContractFingerprintMap(expected)
}

func (s *Adapter) FailFinalizationActivity(
	ctx context.Context,
	run execution.DurableRun,
	tool string,
	failureKind string,
	failCloseReason string,
	cause error,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	if err := s.GuardAgainstFinalizationSuccess(ctx, run, failureKind); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	summary := activityprojection.SummarizeTemporalFailure(failureKind)
	operation := strings.TrimSpace(tool)
	if operation == "" {
		operation = "finalization.write"
	}
	failure := map[string]any{"code": summary.Kind, "operation": operation}
	var citationErr *WorkflowCitationValidationError
	if errors.As(cause, &citationErr) {
		failure["reason"] = citationErr.Reason
		failure["citation"] = citationErr.Citation
		failure["detail"] = citationErr.Error()
	}
	err := s.ProjectTemporalFailureStep(ctx, run, activityprojection.TemporalStepFailureProjection{
		Tool:            tool,
		FailureKind:     summary.Kind,
		ProjectionRef:   activityprojection.TemporalProjectionRef(run.RequestID, "finalization/write"),
		ResultKind:      "activity_failure",
		StepID:          "finalization.write",
		StepKind:        "finalization",
		TaskQueue:       temporalruntime.ActivityTaskQueueCore,
		FailCloseReason: failCloseReason,
		Payload: map[string]any{
			"failure": failure,
		},
	}, cause)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"activity_projection_failed",
			err,
			false,
		)
	}
	return temporalruntime.WorkflowFinalizationActivityOutput{}, activityprojection.TemporalApplicationError(summary, true)
}

func (s *Adapter) FailTemporalRun(
	ctx context.Context,
	run execution.DurableRun,
	projection activityprojection.TemporalStepFailureProjection,
	cause error,
) (execution.DurableRun, error) {
	if run.Status != execution.DurableRunStatusFailed {
		if err := s.GuardAgainstFinalizationSuccess(ctx, run, projection.FailureKind); err != nil {
			return execution.DurableRun{}, err
		}
	}
	failedAt := projection.FailedAt
	if failedAt.IsZero() {
		failedAt = time.Now().UTC()
	}
	failedAt = failedAt.UTC()
	failureKind := projection.FailureKind
	summary := activityprojection.SummarizeTemporalFailure(failureKind)
	failureKind = summary.Kind
	terminalError := TemporalRunFailureErrorPayload(projection, failureKind)
	terminalReason := TemporalFailureTerminalReason(projection, failureKind)
	if run.Status != execution.DurableRunStatusFailed {
		if err := s.AppendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RequestID + ":activity-failed:" + failureKind,
			RequestID:            run.RequestID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeActivityFailed,
			OccurredAt:           failedAt,
			Visibility:           execution.DurableRunEventVisibilityInternal,
			PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{
				"failure": activityprojection.TemporalFailurePayload(projection)["failure"],
				"step_id": projection.StepID,
				"message": summary.Message,
			},
		}); err != nil {
			return execution.DurableRun{}, err
		}
		writeProductFinalization := s.ProductFinalizationWriter
		if writeProductFinalization == nil {
			writeProductFinalization = s.WriteChatProductFinalization
		}
		if err := writeProductFinalization(
			ctx,
			run,
			failedAt,
			ProductTerminalErrorResponse(
				run,
				"error",
				execution.StringValue(terminalError["code"]),
				execution.StringValue(terminalError["message"]),
				TemporalRunFailureRetryable(projection, failureKind),
			),
		); err != nil {
			return execution.DurableRun{}, err
		}
	}
	failedRun, transitionErr := s.RunProjectionStore.FailRunProjection(
		ctx,
		execution.DurableRunFailRequest{
			Now:             failedAt,
			RequestID:       run.RequestID,
			FailCloseReason: activityprojection.TemporalFailureFailCloseReason(projection),
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

func TemporalFailureTerminalReason(
	projection activityprojection.TemporalStepFailureProjection,
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
	case "agent_runtime_timeout", "agent_deadline_exceeded", "workflow_execution_timeout":
		return execution.DurableTerminalReasonRunTimeout
	case "provider_rate_limited",
		"provider_http_failed",
		"provider_connection_failed",
		"provider_timeout",
		"provider_unavailable":
		return execution.DurableTerminalReasonProviderUnavailable
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
		"finalization_projection_conflict",
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
		"runtime_invariant_failed":
		return execution.DurableTerminalReasonRuntimeInvariant
	default:
		return execution.DurableTerminalReasonExecutionFailed
	}
}

func TemporalRunFailureRetryable(
	projection activityprojection.TemporalStepFailureProjection,
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

func TemporalRunFailureErrorPayload(
	projection activityprojection.TemporalStepFailureProjection,
	failureKind string,
) map[string]any {
	summary := activityprojection.SummarizeTemporalFailure(failureKind)
	return map[string]any{
		"code":      summary.Kind,
		"message":   summary.Message,
		"retryable": TemporalRunFailureRetryable(projection, failureKind),
	}
}
