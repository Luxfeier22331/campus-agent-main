package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) ExecuteTypedToolActivity(
	ctx context.Context,
	input temporalruntime.ExecuteTypedToolActivityInput,
) (temporalruntime.ExecuteTypedToolActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExecuteTypedToolActivityOutput{}, err
	}
	if err := validateTypedToolActivityInput(input); err != nil {
		return s.failTypedToolActivity(ctx, run, input, "typed_tool_input_invalid", err)
	}
	startedAt := time.Now().UTC()
	resultRef := temporalProjectionRef(run.RunID, "tools/"+input.ToolName)
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          input.ToolTarget,
		Run:           run,
		Status:        "started",
		StepID:        "typed_tool.execute",
		StepKind:      "tool",
		TaskQueue:     temporalruntime.ActivityTaskQueueForToolTarget(input.ToolTarget),
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: resultRef,
		Payload: map[string]any{
			"payload_kind":   input.PayloadKind,
			"route_plan_ref": input.RoutePlanRef,
			"selected_tool":  input.ToolName,
			"tool_target":    input.ToolTarget,
			"task_queue":     input.TaskQueue,
		},
	}); err != nil {
		return temporalruntime.ExecuteTypedToolActivityOutput{}, err
	}
	rawPayload, err := toolReadModelPayload(&execution.RuntimeHandoff{
		ToolTarget:   input.ToolTarget,
		TaskQueue:    input.TaskQueue,
		PayloadKind:  input.PayloadKind,
		Payload:      input.Payload,
		AllowedTools: append([]string{}, input.AllowedTools...),
	}, map[string]any{})
	if err != nil {
		return s.failTypedToolActivity(ctx, run, input, "typed_tool_payload_invalid", err)
	}
	response := s.executeToolReadModelRuntime(ctx, input.PayloadKind, rawPayload)
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return s.failTypedToolActivity(
			ctx,
			run,
			input,
			"typed_tool_runtime_failed",
			fmt.Errorf("tool read model runtime returned status %d", response.StatusCode),
		)
	}
	resultBody, err := toolReadModelResultMap(response.Body)
	if err != nil {
		return s.failTypedToolActivity(ctx, run, input, "typed_tool_result_invalid", err)
	}
	if err := s.replaceTemporalToolMetadata(ctx, run, func(metadata map[string]any) {
		metadata[input.ToolName] = map[string]any{
			"payload_kind": input.PayloadKind,
			"result":       resultBody,
			"result_ref":   resultRef,
			"tool_name":    input.ToolName,
			"tool_target":  input.ToolTarget,
		}
	}); err != nil {
		return temporalruntime.ExecuteTypedToolActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          input.ToolTarget,
		Run:           run,
		Status:        "completed",
		StepID:        "typed_tool.execute",
		StepKind:      "tool",
		TaskQueue:     temporalruntime.ActivityTaskQueueForToolTarget(input.ToolTarget),
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "typed_tool_result",
		ProjectionRef: resultRef,
		Payload: map[string]any{
			"outcome":        resultBody["outcome"],
			"payload_kind":   input.PayloadKind,
			"route_plan_ref": input.RoutePlanRef,
			"selected_tool":  input.ToolName,
			"tool_target":    input.ToolTarget,
			"task_queue":     input.TaskQueue,
		},
	}); err != nil {
		return temporalruntime.ExecuteTypedToolActivityOutput{}, err
	}
	return temporalruntime.ExecuteTypedToolActivityOutput{
		PayloadKind: input.PayloadKind,
		ResultRef:   resultRef,
		RunID:       run.RunID,
		Status:      "completed",
		ToolName:    input.ToolName,
		ToolTarget:  input.ToolTarget,
	}, nil
}

func validateTypedToolActivityInput(input temporalruntime.ExecuteTypedToolActivityInput) error {
	toolTarget := strings.TrimSpace(input.ToolTarget)
	toolName := strings.TrimSpace(input.ToolName)
	payloadKind := strings.TrimSpace(input.PayloadKind)
	if toolTarget == "" || toolName == "" || payloadKind == "" {
		return fmt.Errorf("tool_target, tool_name, and payload_kind are required")
	}
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return fmt.Errorf("tool registry is not available")
	}
	tool, ok := registry.ToolByName(toolName)
	if !ok {
		return fmt.Errorf("tool %s is not admitted", toolName)
	}
	if tool.Exposure == "closed" || tool.Handler.Type != "execution_control_internal_query" || toolName != payloadKind {
		return fmt.Errorf("tool %s is not admitted for typed activity", toolName)
	}
	return nil
}

func (s *Server) failTypedToolActivity(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecuteTypedToolActivityInput,
	failureKind string,
	cause error,
) (temporalruntime.ExecuteTypedToolActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		Tool:          input.ToolTarget,
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "tools/failure"),
		ResultKind:    "activity_failure",
		StepID:        "typed_tool.execute",
		StepKind:      "tool",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.ExecuteTypedToolActivityOutput{}, err
}

func (s *Server) replaceTemporalToolMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	toolMetadata := cloneAnyMapFromMetadata(metadata["temporal_tools"])
	mutate(toolMetadata)
	metadata["temporal_tools"] = toolMetadata
	return s.runProjectionStore.ReplaceRunMetadata(ctx, latest.RunID, metadata)
}

type temporalToolResultMetadata struct {
	PayloadKind string
	Result      map[string]any
	ResultRef   string
	ToolName    string
	ToolTarget  string
}

func temporalToolResultFromRun(
	run execution.DurableRun,
	resultRef string,
	toolName string,
) (temporalToolResultMetadata, error) {
	expectedRef := strings.TrimSpace(resultRef)
	if expectedRef == "" {
		return temporalToolResultMetadata{}, fmt.Errorf("tool result ref is required")
	}
	tools, ok := run.Metadata["temporal_tools"].(map[string]any)
	if !ok || len(tools) == 0 {
		return temporalToolResultMetadata{}, fmt.Errorf("run metadata.temporal_tools is required")
	}
	expectedTool := strings.TrimSpace(toolName)
	if expectedTool != "" {
		raw, exists := tools[expectedTool]
		if !exists {
			return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result %s is required", expectedTool)
		}
		return decodeTemporalToolResult(raw, expectedRef, expectedTool)
	}
	for _, raw := range tools {
		result, err := decodeTemporalToolResult(raw, expectedRef, "")
		if err == nil {
			return result, nil
		}
	}
	return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result ref %s is required", expectedRef)
}

func decodeTemporalToolResult(
	raw any,
	expectedRef string,
	expectedTool string,
) (temporalToolResultMetadata, error) {
	record, ok := raw.(map[string]any)
	if !ok {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result must be an object")
	}
	resultRef := strings.TrimSpace(stringValue(record["result_ref"]))
	if resultRef == "" {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result ref is required")
	}
	if resultRef != expectedRef {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result ref drift")
	}
	toolName := strings.TrimSpace(stringValue(record["tool_name"]))
	if toolName == "" {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool name is required")
	}
	if expectedTool != "" && toolName != expectedTool {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool name drift")
	}
	toolTarget := strings.TrimSpace(stringValue(record["tool_target"]))
	payloadKind := strings.TrimSpace(stringValue(record["payload_kind"]))
	if toolTarget == "" || payloadKind == "" {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool target and payload kind are required")
	}
	result, ok := record["result"].(map[string]any)
	if !ok || result == nil {
		return temporalToolResultMetadata{}, fmt.Errorf("temporal tool result must be an object")
	}
	return temporalToolResultMetadata{
		PayloadKind: payloadKind,
		Result:      result,
		ResultRef:   resultRef,
		ToolName:    toolName,
		ToolTarget:  toolTarget,
	}, nil
}

func (s *Server) writeTypedToolFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	run, err := s.temporalActivityRunAllowCompletedToolFinalization(
		ctx,
		input.RunID,
		input.TraceID,
		input.ToolResultRef,
	)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return temporalruntime.WriteFinalizationActivityOutput{
			CompletedAt:   run.CompletedAt,
			ProjectionRef: temporalProjectionRef(run.RunID, "finalization/write"),
			RunID:         run.RunID,
			Status:        string(run.Status),
		}, nil
	}
	toolResult, err := temporalToolResultFromRun(run, input.ToolResultRef, input.SelectedTool)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, input.SelectedTool, "typed_tool_result_missing", err)
	}
	toolName := defaultString(strings.TrimSpace(input.SelectedTool), toolResult.ToolName)
	finalizedResponse := shapeStructuredExecutionResponse(
		toolName,
		toolResult.PayloadKind,
		toolResult.Result,
		run.TraceID,
		executionFinalizerContext{
			SelectedTool: toolName,
			RuntimeDecisions: execution.RuntimeDecisionSummary{
				PlanningOutcome:   "preplanned",
				RoutingNextAction: "delegate",
				SelectedTool:      toolName,
			},
			Handoff: &execution.RuntimeHandoff{
				ToolTarget:   toolName,
				TaskQueue:    temporalruntime.ActivityTaskQueueForToolTarget(toolName),
				PayloadKind:  toolResult.PayloadKind,
				AllowedTools: []string{toolName},
			},
			Branch: "tool_execution",
		},
	)
	finalizationStartedAt := time.Now().UTC()
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          toolName,
		Run:           run,
		Status:        "started",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		UpdatedAt:     finalizationStartedAt,
		ProjectionRef: finalizationRef,
		Payload: map[string]any{
			"selected_tool":   toolName,
			"tool_result_ref": input.ToolResultRef,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	finalizedResponse, err = s.attachRunUsageSummary(ctx, run.RunID, finalizedResponse)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
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
			"request_id":      run.RequestID,
			"response":        finalizedResponse,
			"tool_result_ref": input.ToolResultRef,
			"trace_id":        run.TraceID,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	completedRun, err := s.runProjectionStore.CompleteRunProjection(
		ctx,
		execution.DurableRunCompleteRequest{
			FinalResponseRef: finalizationRef,
			Now:              completedAt,
			RunID:            run.RunID,
			SelectedTool:     toolName,
			TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
		},
	)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
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
			"projection_ref":  finalizationRef,
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          toolName,
		Run:           run,
		Status:        "completed",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "final_answer_projection",
		ProjectionRef: finalizationRef,
		Payload:       temporalFinalizationResultPayload(finalizedResponse, input, run),
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	return temporalruntime.WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: temporalProjectionRef(completedRun.RunID, "finalization/write"),
		RunID:         completedRun.RunID,
		Status:        string(completedRun.Status),
	}, nil
}
