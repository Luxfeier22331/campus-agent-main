package httpapi

import (
	"context"
	"fmt"
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
	if _, err := semanticExecutionRequestForRun(run); err != nil {
		return s.failTemporalPlanning(ctx, run, "bridge_payload_invalid", err)
	}
	now := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "planning",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		UpdatedAt:     now,
		ResultKind:    "",
		ProjectionRef: temporalProjectionRef(run.RunID, "plan"),
		Payload: map[string]any{
			"namespace":       input.Namespace,
			"payload_sha256":  input.PayloadSHA256,
			"policy_versions": input.PolicyVersions,
			"workflow_id":     input.WorkflowID,
		},
	}); err != nil {
		return temporalruntime.PlanChatAnswerActivityOutput{}, err
	}
	switch run.Status {
	case execution.DurableRunStatusQueued:
		admitted, err := s.runProjectionStore.TransitionRun(
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
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "planning",
		StepKind:      "planning",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "workflow_plan",
		ProjectionRef: temporalProjectionRef(run.RunID, "plan"),
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
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "semantic.rag",
		StepKind:      "typed_activity",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "semantic/rag"),
		Payload:       map[string]any{"plan_ref": input.PlanRef},
	}); err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
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
		run, err = s.runProjectionStore.TransitionRun(
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
	executionRequest, err := semanticExecutionRequestForRun(run)
	if err != nil {
		return s.failSemanticWorkerActivity(ctx, run, "bridge_payload_invalid", err)
	}
	bridgeCtx, bridgeCancel := context.WithTimeout(
		ctx,
		time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond,
	)
	defer bridgeCancel()
	response, bridgeErr := s.bridge.ExecuteSemantic(bridgeCtx, bridge.SemanticExecutionRequest{
		RunID:           run.RunID,
		StepExecutionID: temporalSemanticBridgeStepExecutionID(run.RunID),
		StepID:          "activity:rag",
		Lane:            string(run.Lane),
		WorkerID:        s.config.TemporalWorkerIdentity,
		Attempt:         1,
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
			fmt.Errorf("semantic bridge status %d", response.StatusCode),
		)
	}
	finalizedResponse, err := semanticFinalizationResponseForBridge(run, response)
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
	if err := s.runProjectionStore.ReplaceRunMetadata(ctx, updatedRun.RunID, updatedRun.Metadata); err != nil {
		return temporalruntime.InvokeSemanticWorkerActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "semantic.rag",
		StepKind:      "typed_activity",
		TaskQueue:     temporalruntime.ActivityTaskQueueRAG,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "semantic_bridge_projection",
		ProjectionRef: bridgeRef,
		Payload: map[string]any{
			"bridge_kind": response.Kind,
			"bridge_ref":  bridgeRef,
			"plan_ref":    input.PlanRef,
		},
	}); err != nil {
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

func temporalSemanticBridgeStepExecutionID(runID string) string {
	return "temporal:" + strings.TrimSpace(runID) + ":semantic.rag"
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
	finalizationStartedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "started",
		StepID:        "finalization",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		UpdatedAt:     finalizationStartedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "finalization"),
		Payload: map[string]any{
			"bridge_ref": input.BridgeRef,
			"plan_ref":   input.PlanRef,
		},
	}); err != nil {
		return temporalruntime.FinalizeChatAnswerActivityOutput{}, err
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
	completedRun, err := s.runProjectionStore.TransitionRun(
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
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "knowledge",
		Run:           run,
		Status:        "completed",
		StepID:        "finalization",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "final_answer_projection",
		ProjectionRef: temporalProjectionRef(run.RunID, "finalization"),
		Payload: map[string]any{
			"bridge_ref": input.BridgeRef,
			"plan_ref":   input.PlanRef,
			"request_id": run.RequestID,
			"trace_id":   run.TraceID,
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
