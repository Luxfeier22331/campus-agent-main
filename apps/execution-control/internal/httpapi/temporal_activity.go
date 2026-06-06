package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PlanChatAnswerActivity(
	ctx context.Context,
	input temporalruntime.PlanChatAnswerActivityInput,
) (temporalruntime.PlanChatAnswerActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	if _, err := durableExecutionRequestForRun(run); err != nil {
		return s.failTemporalPlanning(ctx, run, "bridge_payload_invalid", err)
	}
	now := time.Now().UTC()
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.durableRuntime.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusAdmitted,
			"",
			now,
		)
		if err != nil {
			return temporalruntime.PlanChatAnswerActivityOutput{}, err
		}
		run = admitted
	case execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
		execution.DurableRunStatusStreaming:
	default:
		return temporalruntime.PlanChatAnswerActivityOutput{}, fmt.Errorf(
			"run %s status %s cannot be planned",
			run.RunID,
			run.Status,
		)
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":workflow-planned",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowPlanned,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"namespace":       input.Namespace,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	return temporalruntime.PlanChatAnswerActivityOutput{
		PlanRef: temporalProjectionRef(run.RunID, "plan"),
		RunID:   run.RunID,
		Status:  "planned",
	}, nil
}

func (s *Server) InvokeSemanticWorkerActivity(
	ctx context.Context,
	input temporalruntime.InvokeSemanticWorkerActivityInput,
) (temporalruntime.InvokeSemanticWorkerActivityOutput, error) {
	if strings.TrimSpace(input.PlanRef) == "" {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, fmt.Errorf("plan_ref is required")
	}
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
	if existingBridgeRef, ok := temporalSemanticBridgeRefFromRun(run, input.PlanRef); ok {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{
			BridgeRef: existingBridgeRef,
			RunID:     run.RunID,
			Status:    "completed",
		}, nil
	}
	if s.bridge == nil || !s.bridge.Configured() {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, fmt.Errorf("semantic bridge is not configured")
	}
	startedAt := time.Now().UTC()
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-rag-started",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityStarted,
		OccurredAt:           startedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":   "rag",
			"plan_ref":   input.PlanRef,
			"task_queue": temporalruntime.ActivityTaskQueueRAG,
		},
	}); err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusAdmitted {
		run, err = s.durableRuntime.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusRunning,
			"",
			startedAt,
		)
		if err != nil {
			return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
		}
	} else if run.Status != execution.DurableRunStatusRunning &&
		run.Status != execution.DurableRunStatusStreaming {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, fmt.Errorf(
			"run %s status %s cannot invoke semantic activity",
			run.RunID,
			run.Status,
		)
	}
	executionRequest, err := durableExecutionRequestForRun(run)
	if err != nil {
		return s.failSemanticWorkerActivity(ctx, run, "bridge_payload_invalid", err)
	}
	bridgeCtx, bridgeCancel := context.WithTimeout(
		ctx,
		time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond,
	)
	defer bridgeCancel()
	response, bridgeErr := s.bridge.ExecuteDurable(bridgeCtx, bridge.DurableExecutionRequest{
		RunID:    run.RunID,
		StepID:   "activity:rag",
		Lane:     string(run.Lane),
		WorkerID: s.config.TemporalWorkerIdentity,
		Execution: bridge.Request{
			Payload: executionRequest,
			TraceHeaders: telemetry.InjectBridgeTraceHeaders(
				ctx,
				run.RequestID,
				run.TraceID,
			),
		},
	})
	if bridgeErr != nil {
		return s.failSemanticWorkerActivity(ctx, run, "bridge_error", bridgeErr)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return s.failSemanticWorkerActivity(
			ctx,
			run,
			"bridge_status",
			fmt.Errorf("durable bridge status %d", response.StatusCode),
		)
	}
	finalizedResponse, err := durableFinalizationResponseForBridge(run, response)
	if err != nil {
		return s.failSemanticWorkerActivity(ctx, run, "bridge_invalid_response", err)
	}
	bridgeRef := temporalProjectionRef(run.RunID, "semantic/rag")
	updatedRun := run
	updatedRun.Metadata = cloneTemporalMetadata(run.Metadata)
	updatedRun.Metadata["temporal_semantic_bridge"] = map[string]any{
		"bridge_kind":        response.Kind,
		"bridge_ref":         bridgeRef,
		"finalized_response": finalizedResponse,
		"plan_ref":           input.PlanRef,
	}
	if err := s.durableRuntime.ReplaceRunMetadata(ctx, updatedRun.RunID, updatedRun.Metadata); err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":activity-rag-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeActivityCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"activity":    "rag",
			"bridge_kind": response.Kind,
			"bridge_ref":  bridgeRef,
			"plan_ref":    input.PlanRef,
		},
	}); err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
	return temporalruntime.InvokeSemanticWorkerActivityOutput{
		BridgeRef: bridgeRef,
		RunID:     run.RunID,
		Status:    "completed",
	}, nil
}

func (s *Server) FinalizeChatAnswerActivity(
	ctx context.Context,
	input temporalruntime.FinalizeChatAnswerActivityInput,
) (temporalruntime.FinalizeChatAnswerActivityOutput, error) {
	if strings.TrimSpace(input.PlanRef) == "" {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, fmt.Errorf("plan_ref is required")
	}
	if strings.TrimSpace(input.BridgeRef) == "" {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, fmt.Errorf("bridge_ref is required")
	}
	run, err := s.temporalActivityRunAllowCompletedFinalization(ctx, input.RunID, input.TraceID, input.BridgeRef)
	if err != nil {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return temporalruntime.FinalizeChatAnswerActivityOutput{
			CompletedAt:   run.CompletedAt,
			ProjectionRef: temporalProjectionRef(run.RunID, "finalization"),
			RunID:         run.RunID,
			Status:        string(run.Status),
		}, nil
	}
	finalizedResponse, err := temporalFinalizedResponseFromRun(run, input.BridgeRef)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "bridge_projection_missing", err)
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":finalization-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"bridge_ref": input.BridgeRef,
			"plan_ref":   input.PlanRef,
			"request_id": run.RequestID,
			"response":   finalizedResponse,
			"trace_id":   run.TraceID,
		},
	}); err != nil {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	completedRun, err := s.durableRuntime.TransitionRun(
		ctx,
		run.RunID,
		execution.DurableRunStatusCompleted,
		execution.DurableTerminalReasonAnswerCompleted,
		completedAt,
	)
	if err != nil {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":run-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"projection_ref":  temporalProjectionRef(run.RunID, "finalization"),
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
		},
	}); err != nil {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
	}
	return temporalruntime.FinalizeChatAnswerActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: temporalProjectionRef(completedRun.RunID, "finalization"),
		RunID:         completedRun.RunID,
		Status:        string(completedRun.Status),
	}, nil
}

func (s *Server) temporalActivityRun(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.durableRuntime == nil {
		return execution.DurableRun{}, execution.ErrDurableRuntimeStoreNotConfigured
	}
	run, err := s.durableRuntime.GetRun(ctx, runID)
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

func (s *Server) temporalActivityRunAllowCompletedFinalization(
	ctx context.Context,
	runID string,
	traceID string,
	bridgeRef string,
) (execution.DurableRun, error) {
	if s == nil || s.durableRuntime == nil {
		return execution.DurableRun{}, execution.ErrDurableRuntimeStoreNotConfigured
	}
	run, err := s.durableRuntime.GetRun(ctx, runID)
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
		if _, err := temporalFinalizedResponseFromRun(run, bridgeRef); err != nil {
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

func (s *Server) failTemporalPlanning(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.PlanChatAnswerActivityOutput, error) {
	_, _ = s.failTemporalRun(ctx, run, failureKind, cause)
	return temporalruntime.PlanChatAnswerActivityOutput{}, cause
}

func (s *Server) failSemanticWorkerActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.InvokeSemanticWorkerActivityOutput, error) {
	_, _ = s.failTemporalRun(ctx, run, failureKind, cause)
	return temporalruntime.InvokeSemanticWorkerActivityOutput{}, cause
}

func (s *Server) failFinalizationActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.FinalizeChatAnswerActivityOutput, error) {
	_, _ = s.failTemporalRun(ctx, run, failureKind, cause)
	return temporalruntime.FinalizeChatAnswerActivityOutput{}, cause
}

func (s *Server) failTemporalRun(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (execution.DurableRun, error) {
	failedAt := time.Now().UTC()
	_, _ = s.durableRuntime.AppendRunEvent(ctx, execution.DurableRunEvent{
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
	failedRun, transitionErr := s.durableRuntime.TransitionRun(
		ctx,
		run.RunID,
		execution.DurableRunStatusFailed,
		execution.DurableTerminalReasonWorkerUnavailable,
		failedAt,
	)
	if transitionErr != nil {
		return execution.DurableRun{}, transitionErr
	}
	_, _ = s.durableRuntime.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":run-failed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunFailed,
		OccurredAt:           failedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"failure_kind":    failureKind,
			"status":          string(execution.DurableRunStatusFailed),
			"terminal_reason": string(execution.DurableTerminalReasonWorkerUnavailable),
		},
	})
	return failedRun, cause
}

func temporalFinalizedResponseFromRun(
	run execution.DurableRun,
	bridgeRef string,
) (map[string]any, error) {
	raw, ok := run.Metadata["temporal_semantic_bridge"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("run metadata.temporal_semantic_bridge is required")
	}
	if strings.TrimSpace(fmt.Sprint(raw["bridge_ref"])) != bridgeRef {
		return nil, fmt.Errorf("semantic bridge ref drift")
	}
	response, ok := raw["finalized_response"].(map[string]any)
	if ok {
		return response, nil
	}
	encoded, err := json.Marshal(raw["finalized_response"])
	if err != nil {
		return nil, fmt.Errorf("encode finalized response projection: %w", err)
	}
	decoded := map[string]any{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return nil, fmt.Errorf("decode finalized response projection: %w", err)
	}
	return decoded, nil
}

func temporalSemanticBridgeRefFromRun(run execution.DurableRun, planRef string) (string, bool) {
	raw, ok := run.Metadata["temporal_semantic_bridge"].(map[string]any)
	if !ok {
		return "", false
	}
	if strings.TrimSpace(fmt.Sprint(raw["plan_ref"])) != strings.TrimSpace(planRef) {
		return "", false
	}
	bridgeRef := strings.TrimSpace(fmt.Sprint(raw["bridge_ref"]))
	if bridgeRef == "" {
		return "", false
	}
	if _, err := temporalFinalizedResponseFromRun(run, bridgeRef); err != nil {
		return "", false
	}
	return bridgeRef, true
}

func temporalProjectionRef(runID string, suffix string) string {
	return "projection://runs/" + strings.TrimSpace(runID) + "/" + strings.TrimSpace(suffix)
}

func (s *Server) appendTemporalRunEvent(ctx context.Context, event execution.DurableRunEvent) error {
	if _, err := s.durableRuntime.AppendRunEvent(ctx, event); err != nil {
		if !errors.Is(err, execution.ErrInvalidRunEvent) {
			return err
		}
		events, listErr := s.durableRuntime.ListRunEvents(ctx, event.RunID)
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
