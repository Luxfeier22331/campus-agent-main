package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) writePrimaryAgentFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	run, err := s.temporalActivityRunAllowCompletedAgentFinalization(
		ctx,
		input.RunID,
		input.TraceID,
		input.AgentResultRef,
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
	agentResult, err := temporalAgentResultFromRun(run, input.AgentResultRef)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "primary_agent", "agent_result_missing", err)
	}
	finalizedResponse, err := primaryAgentFinalizedResponse(run, agentResult)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "primary_agent", "agent_finalization_invalid", err)
	}
	finalizationStartedAt := time.Now().UTC()
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "primary_agent",
		Run:           run,
		Status:        "started",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     finalizationStartedAt,
		UpdatedAt:     finalizationStartedAt,
		ProjectionRef: finalizationRef,
		Payload: map[string]any{
			"agent_result_ref": input.AgentResultRef,
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
			"agent_result_ref": input.AgentResultRef,
			"request_id":       run.RequestID,
			"response":         finalizedResponse,
			"trace_id":         run.TraceID,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	terminalReason := primaryAgentTerminalReason(agentResult)
	selectedCapability := primaryAgentSelectedCapability(stringSliceFromAny(agentResult["selected_tools"]))
	completedRun, err := s.runProjectionStore.CompleteRunProjection(
		ctx,
		execution.DurableRunCompleteRequest{
			FinalResponseRef:   finalizationRef,
			Now:                completedAt,
			RunID:              run.RunID,
			SelectedCapability: selectedCapability,
			TerminalReason:     terminalReason,
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
			"terminal_reason": string(terminalReason),
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "primary_agent",
		Run:           run,
		Status:        "completed",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueFinalization,
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

func primaryAgentFinalizedResponse(
	run execution.DurableRun,
	agentResult map[string]any,
) (map[string]any, error) {
	envelope := cloneAnyMapFromMetadata(agentResult["terminal_envelope"])
	if !validPrimaryAgentTerminalEnvelope(envelope) {
		return nil, fmt.Errorf("agent terminal_envelope is required")
	}
	selectedTools := stringSliceFromAny(agentResult["selected_tools"])
	selectedCapability := primaryAgentSelectedCapability(selectedTools)
	terminalKind := primaryAgentTerminalKind(envelope)
	answerText := primaryAgentEnvelopeAnswerText(envelope)
	status, followUpQuestion, confidence := primaryAgentResponseFields(terminalKind, answerText)
	traceSelectedCapability := primaryAgentTraceSelectedCapability(selectedCapability)
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		SelectedCapability: primaryAgentResponseSelectedCapability(selectedCapability),
		Status:             status,
		AnswerText:         primaryAgentAnswerText(status, answerText),
		Error:              primaryAgentErrorBody(status, terminalKind),
		FollowUpQuestion:   followUpQuestion,
		Confidence:         confidence,
		Result: map[string]any{
			"agent_result_ref":     agentResult["agent_result_ref"],
			"provider_response_id": agentResult["provider_response_id"],
			"selected_tools":       selectedTools,
			"terminal_envelope":    envelope,
			"tool_results":         agentResult["tool_results"],
			"terminal_reason":      terminalKind,
		},
		Observability: map[string]any{
			"agent_runtime":   "openai_agents_sdk",
			"selected_tools":  selectedTools,
			"sdk_trace_ref":   agentResult["sdk_trace_ref"],
			"terminal_reason": terminalKind,
		},
		WorkflowTraceSummary: map[string]any{
			"workflow_mode":             primaryAgentWorkflowMode(selectedTools),
			"selected_capability":       traceSelectedCapability,
			"selected_tools":            selectedTools,
			"first_decision_actor":      "primary_agent",
			"planning_outcome":          primaryAgentPlanningOutcome(terminalKind),
			"direct_vs_delegate_branch": primaryAgentTraceBranch(terminalKind, selectedTools),
			"terminal_reason":           terminalKind,
			"answer_artifact_kinds":     []string{"agent_final_output"},
			"answer_artifact_refs":      []string{strings.TrimSpace(stringValue(agentResult["agent_result_ref"]))},
			"trace_steps":               primaryAgentTraceSteps(selectedTools, selectedCapability, agentResult, status),
			"tool_call_summaries":       primaryAgentToolCallSummaries(agentResult),
			"runtime_versions":          map[string]any{"agent_runtime": "openai_agents_sdk"},
		},
		TraceID: run.TraceID,
	}), nil
}

func primaryAgentTerminalReason(agentResult map[string]any) execution.DurableTerminalReason {
	switch primaryAgentTerminalKind(cloneAnyMapFromMetadata(agentResult["terminal_envelope"])) {
	case "clarification_required":
		return execution.DurableTerminalReasonClarificationRequired
	case "out_of_scope", "policy_refusal":
		return execution.DurableTerminalReasonPolicyRejected
	case "unsupported_by_evidence":
		return execution.DurableTerminalReasonNoAnswerGrounded
	default:
		return execution.DurableTerminalReasonAnswerCompleted
	}
}

func primaryAgentResponseFields(terminalReason string, answerText string) (string, string, string) {
	switch terminalReason {
	case "clarification_required":
		return "needs_clarification", answerText, "medium"
	case "out_of_scope", "policy_refusal":
		return "rejected", "", "low"
	case "unsupported_by_evidence":
		return "no_answer", "", "low"
	default:
		return "completed", "", "medium"
	}
}

func primaryAgentErrorBody(status string, terminalReason string) any {
	if status != "rejected" {
		return nil
	}
	code := "request_rejected"
	message := "The request was rejected by execution policy."
	if strings.TrimSpace(terminalReason) == "out_of_scope" {
		message = "The request is outside the current campus assistant scope."
	}
	return map[string]any{
		"code":      code,
		"message":   message,
		"retryable": false,
	}
}

func primaryAgentAnswerText(status string, answerText string) string {
	if status == "needs_clarification" {
		return ""
	}
	return answerText
}

func primaryAgentTraceBranch(terminalReason string, selectedTools []string) string {
	if len(selectedTools) > 0 {
		return "tool"
	}
	switch terminalReason {
	case "clarification_required":
		return "clarification"
	case "out_of_scope":
		return "out_of_scope"
	case "policy_refusal":
		return "policy_refusal"
	case "unsupported_by_evidence":
		return "unsupported"
	default:
		return "direct_answer"
	}
}

func primaryAgentTerminalKind(envelope map[string]any) string {
	kind := strings.TrimSpace(stringValue(envelope["kind"]))
	if kind == "" {
		return "answer"
	}
	return kind
}

func primaryAgentEnvelopeAnswerText(envelope map[string]any) string {
	kind := primaryAgentTerminalKind(envelope)
	switch kind {
	case "clarification_required":
		if followUp := strings.TrimSpace(stringValue(envelope["follow_up_question"])); followUp != "" {
			return followUp
		}
		return strings.TrimSpace(stringValue(envelope["answer_text"]))
	case "answer":
		return strings.TrimSpace(stringValue(envelope["answer_text"]))
	default:
		if answerText := strings.TrimSpace(stringValue(envelope["answer_text"])); answerText != "" {
			return answerText
		}
		return strings.TrimSpace(stringValue(envelope["reason"]))
	}
}

func primaryAgentSelectedCapability(selectedTools []string) string {
	if len(selectedTools) == 0 {
		return ""
	}
	for _, tool := range selectedTools {
		switch tool {
		case "transport_schedule_lookup":
			return "campus_services"
		case "campus_notice_change_set_lookup", "campus_notice_discover", "campus_notice_period_summary":
			return "notice"
		case "knowledge_query":
			return "knowledge"
		}
	}
	return ""
}

func primaryAgentResponseSelectedCapability(selectedCapability string) *string {
	selectedCapability = strings.TrimSpace(selectedCapability)
	if selectedCapability == "" {
		return nil
	}
	return &selectedCapability
}

func primaryAgentTraceSelectedCapability(selectedCapability string) string {
	selectedCapability = strings.TrimSpace(selectedCapability)
	if selectedCapability == "" {
		return "none"
	}
	return selectedCapability
}

func primaryAgentWorkflowMode(selectedTools []string) string {
	if len(selectedTools) == 0 {
		return "terminal"
	}
	return "single_step"
}

func primaryAgentPlanningOutcome(terminalReason string) string {
	if strings.TrimSpace(terminalReason) == "tool_selected" {
		return "primary_agent_tool_selected"
	}
	return "primary_agent_completed"
}

func primaryAgentTraceSteps(
	selectedTools []string,
	selectedCapability string,
	agentResult map[string]any,
	status string,
) []map[string]any {
	steps := []map[string]any{{
		"step_id":        "agent.primary",
		"span_kind":      "agent",
		"parent_step_id": "",
		"outcome":        defaultString(primaryAgentTerminalKind(cloneAnyMapFromMetadata(agentResult["terminal_envelope"])), status),
		"result_status":  status,
	}}
	toolResults := primaryAgentToolResultMaps(agentResult["tool_results"])
	for index, tool := range selectedTools {
		toolResult := map[string]any{}
		if index < len(toolResults) {
			toolResult = toolResults[index]
		}
		resultStatus := primaryAgentToolResultStatus(toolResult)
		if resultStatus == "" {
			resultStatus = status
		}
		steps = append(steps, map[string]any{
			"step_id":        primaryAgentToolStepID(tool, index),
			"span_kind":      "tool_call",
			"parent_step_id": "agent.primary",
			"tool_name":      tool,
			"capability":     defaultString(strings.TrimSpace(stringValue(toolResult["capability"])), selectedCapability),
			"outcome":        resultStatus,
			"result_status":  resultStatus,
			"retry_count":    0,
		})
	}
	finalizationParent := "agent.primary"
	if len(selectedTools) > 0 {
		finalizationParent = primaryAgentToolStepID(selectedTools[len(selectedTools)-1], len(selectedTools)-1)
	}
	steps = append(steps, map[string]any{
		"step_id":        "finalization.write",
		"span_kind":      "finalization",
		"parent_step_id": finalizationParent,
		"outcome":        status,
		"result_status":  status,
	})
	return steps
}

func primaryAgentToolCallSummaries(agentResult map[string]any) []map[string]any {
	toolResults := primaryAgentToolResultMaps(agentResult["tool_results"])
	if len(toolResults) == 0 {
		return []map[string]any{}
	}
	summaries := make([]map[string]any, 0, len(toolResults))
	for index, toolResult := range toolResults {
		toolName := strings.TrimSpace(stringValue(toolResult["tool_name"]))
		capability := strings.TrimSpace(stringValue(toolResult["capability"]))
		resultStatus := primaryAgentToolResultStatus(toolResult)
		result := cloneAnyMapFromMetadata(toolResult["result"])
		summary := map[string]any{
			"schema_version":      "tool-call-summary-v1",
			"tool_call_id":        primaryAgentToolCallID(agentResult, toolName, index),
			"workflow_run_ref":    strings.TrimSpace(stringValue(agentResult["agent_result_ref"])),
			"step_id":             primaryAgentToolStepID(toolName, index),
			"lifecycle_state":     workflowToolLifecycleState(resultStatus),
			"result_projection":   "bounded_summary",
			"raw_result_included": false,
			"tool_name":           toolName,
			"capability":          capability,
			"payload_kind":        strings.TrimSpace(stringValue(toolResult["payload_kind"])),
			"result_status":       resultStatus,
			"argument_summary":    safeWorkflowMap(cloneAnyMapFromMetadata(toolResult["arguments_json"])),
			"source_ids":          workflowSourceIDs(result),
		}
		if businessOutcome := strings.TrimSpace(stringValue(result["outcome"])); businessOutcome != "" {
			summary["business_outcome"] = businessOutcome
		}
		if failCloseReason := strings.TrimSpace(stringValue(toolResult["fail_close_reason"])); failCloseReason != "" {
			summary["fail_close_reason"] = failCloseReason
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

func primaryAgentToolResultMaps(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, typed...)
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			result := cloneAnyMapFromMetadata(item)
			if len(result) > 0 {
				items = append(items, result)
			}
		}
		return items
	default:
		return []map[string]any{}
	}
}

func primaryAgentToolResultStatus(toolResult map[string]any) string {
	result := cloneAnyMapFromMetadata(toolResult["result"])
	if outcome := strings.TrimSpace(stringValue(result["outcome"])); outcome != "" {
		return outcome
	}
	return strings.TrimSpace(stringValue(toolResult["status"]))
}

func primaryAgentToolCallID(agentResult map[string]any, toolName string, index int) string {
	workflowRunRef := strings.TrimSpace(stringValue(agentResult["agent_result_ref"]))
	if workflowRunRef == "" {
		workflowRunRef = "agent.primary"
	}
	return workflowRunRef + ":" + primaryAgentToolStepID(toolName, index)
}

func primaryAgentToolStepID(toolName string, index int) string {
	normalizedToolName := strings.TrimSpace(toolName)
	if normalizedToolName == "" {
		normalizedToolName = "tool"
	}
	return fmt.Sprintf("sdk_tool.execute.%s.%d", normalizedToolName, index+1)
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string{}, typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return []string{}
	}
}
