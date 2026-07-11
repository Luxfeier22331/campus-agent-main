package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	return s.writePrimaryAgentFinalizationActivity(ctx, input)
}

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
		return s.failFinalizationActivity(ctx, run, "", "agent_result_missing", err)
	}
	finalizationStartedAt := time.Now().UTC()
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          "",
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
			"agent_result_ref": input.AgentResultRef,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	finalizedResponse, err := s.primaryAgentFinalizedResponse(
		ctx,
		run,
		agentResult,
		stageTimingDuration{
			field:    "finalization.write_ms",
			duration: durationBetween(finalizationStartedAt, completedAt),
		},
	)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "", "agent_finalization_invalid", err)
	}
	if err := s.appendTemporalFinalizationCompletedEvents(ctx, run, time.Now().UTC(), finalizedResponse, map[string]any{
		"agent_result_ref": input.AgentResultRef,
		"request_id":       run.RequestID,
		"trace_id":         run.TraceID,
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	terminalReason := primaryAgentTerminalReason(agentResult)
	selectedTool := primaryAgentSelectedTool(stringSliceFromAny(agentResult["selected_tools"]))
	completedRun, err := s.runProjectionStore.CompleteRunProjection(
		ctx,
		execution.DurableRunCompleteRequest{
			FinalResponseRef: finalizationRef,
			Now:              completedAt,
			RunID:            run.RunID,
			SelectedTool:     selectedTool,
			TerminalReason:   terminalReason,
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
		Tool:          "",
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

func (s *Server) primaryAgentFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	agentResult map[string]any,
	additionalStageTiming ...stageTimingDuration,
) (map[string]any, error) {
	envelope := cloneAnyMapFromMetadata(agentResult["terminal_envelope"])
	if !validPrimaryAgentTerminalEnvelope(envelope) {
		return nil, fmt.Errorf("agent terminal_envelope is required")
	}
	evidenceClosure, err := primaryAgentEvidenceClosureForFinalization(run, agentResult, envelope)
	if err != nil {
		return nil, err
	}
	runtimeSelectedTools := stringSliceFromAny(agentResult["selected_tools"])
	selectedTools := primaryAgentPublicSelectedTools(runtimeSelectedTools)
	selectedTool := primaryAgentSelectedTool(selectedTools)
	terminalKind := primaryAgentTerminalKind(envelope)
	answerText := primaryAgentEnvelopeAnswerText(envelope)
	status, followUpQuestion, confidence := primaryAgentResponseFields(terminalKind, answerText)
	traceSelectedTool := primaryAgentTraceSelectedTool(selectedTool)
	stageTiming, err := s.stageTimingForRun(
		ctx,
		run,
		cloneAnyMapFromMetadata(agentResult["stage_timing"]),
		additionalStageTiming...,
	)
	if err != nil {
		return nil, err
	}
	llmIOFingerprint, ok := primaryAgentSafeLLMIOFingerprint(agentResult)
	if !ok {
		return nil, fmt.Errorf("agent llm_io_fingerprint is required")
	}
	workflowMode := primaryAgentWorkflowMode(selectedTools)
	workflowTraceSummary := map[string]any{
		"workflow_mode":             workflowMode,
		"selected_tool":             traceSelectedTool,
		"selected_tools":            selectedTools,
		"first_decision_actor":      "primary_agent",
		"planning_outcome":          "primary_agent_completed",
		"direct_vs_delegate_branch": primaryAgentTraceBranch(terminalKind, selectedTools),
		"terminal_reason":           terminalKind,
		"answer_artifact_kinds":     []string{"agent_final_output"},
		"answer_artifact_refs":      []string{strings.TrimSpace(stringValue(agentResult["agent_result_ref"]))},
		"trace_steps":               primaryAgentTraceSteps(selectedTools, selectedTool, agentResult, status),
		"tool_call_summaries":       primaryAgentToolCallSummaries(agentResult),
		"runtime_versions":          map[string]any{"agent_runtime": "openai_agents_sdk"},
	}
	observability := map[string]any{
		"agent_runtime":      "openai_agents_sdk",
		"llm_io_fingerprint": llmIOFingerprint,
		"selected_tools":     selectedTools,
		"sdk_trace_ref":      agentResult["sdk_trace_ref"],
		"terminal_reason":    terminalKind,
	}
	observability["answer_eval_fingerprint"] = answerEvalFingerprint(answerEvalFingerprintInput{
		BranchKind:       primaryAgentAnswerBranchKind(terminalKind, selectedTools),
		LLMIOFingerprint: llmIOFingerprint,
		RunID:            run.RunID,
		SelectedTool:     selectedTool,
		SelectedTools:    selectedTools,
		StageTiming:      stageTiming,
		TerminalOutcome:  primaryAgentAnswerTerminalOutcome(status, terminalKind),
		WorkflowMode:     workflowMode,
	})
	result := map[string]any{
		"provider_response_id": agentResult["provider_response_id"],
		"selected_tools":       selectedTools,
		"sources":              evidenceClosure.Sources,
		"terminal_reason":      terminalKind,
	}
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		SelectedTool:         primaryAgentResponseSelectedTool(selectedTool),
		Status:               status,
		AnswerText:           primaryAgentAnswerText(status, answerText),
		DebugTraceRefs:       debugTraceRefsFromAgentResult(agentResult),
		Error:                primaryAgentErrorBody(status, terminalKind),
		FollowUpQuestion:     followUpQuestion,
		Confidence:           confidence,
		StageTiming:          stageTiming,
		ResolvedScope:        optionalStringPointer(evidenceClosure.ResolvedScope),
		Result:               result,
		SessionUpdate:        evidenceClosure.SessionUpdate,
		Observability:        observability,
		WorkflowTraceSummary: workflowTraceSummary,
		TraceID:              run.TraceID,
	}), nil
}

func optionalStringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func debugTraceRefsFromAgentResult(agentResult map[string]any) []map[string]any {
	refs, _ := agentResult["debug_trace_refs"].([]any)
	result := make([]map[string]any, 0, len(refs))
	for _, raw := range refs {
		ref := cloneAnyMapFromMetadata(raw)
		if strings.TrimSpace(stringValue(ref["sink"])) == "" ||
			strings.TrimSpace(stringValue(ref["trace_ref"])) == "" {
			continue
		}
		result = append(result, ref)
	}
	return result
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

func primaryAgentSelectedTool(selectedTools []string) string {
	if len(selectedTools) == 0 {
		return ""
	}
	for _, tool := range selectedTools {
		switch tool {
		case "transport_schedule_lookup":
			return "transport_schedule_lookup"
		case "knowledge_query":
			return "knowledge_query"
		case "knowledge_search":
			return "knowledge_query"
		}
	}
	return ""
}

func primaryAgentPublicSelectedTools(selectedTools []string) []string {
	result := make([]string, 0, len(selectedTools))
	seen := map[string]struct{}{}
	for _, tool := range selectedTools {
		publicTool := strings.TrimSpace(tool)
		if publicTool == "knowledge_search" {
			publicTool = "knowledge_query"
		}
		if publicTool == "" {
			continue
		}
		if _, exists := seen[publicTool]; exists {
			continue
		}
		seen[publicTool] = struct{}{}
		result = append(result, publicTool)
	}
	return result
}

func primaryAgentResponseSelectedTool(selectedTool string) *string {
	selectedTool = strings.TrimSpace(selectedTool)
	if selectedTool == "" {
		return nil
	}
	return &selectedTool
}

func primaryAgentTraceSelectedTool(selectedTool string) string {
	selectedTool = strings.TrimSpace(selectedTool)
	if selectedTool == "" {
		return "none"
	}
	return selectedTool
}

func primaryAgentWorkflowMode(selectedTools []string) string {
	if len(selectedTools) == 0 {
		return "terminal"
	}
	return "single_step"
}

func primaryAgentTraceSteps(
	selectedTools []string,
	selectedTool string,
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
			"tool":           defaultString(strings.TrimSpace(stringValue(toolResult["tool"])), selectedTool),
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
		tool := strings.TrimSpace(stringValue(toolResult["tool"]))
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
			"tool":                tool,
			"payload_kind":        strings.TrimSpace(stringValue(toolResult["payload_kind"])),
			"result_status":       resultStatus,
			"argument_summary": map[string]any{
				"arguments_json_sha256":    strings.TrimSpace(stringValue(toolResult["arguments_json_sha256"])),
				"arguments_schema_sha256":  strings.TrimSpace(stringValue(toolResult["arguments_schema_sha256"])),
				"arguments_schema_version": strings.TrimSpace(stringValue(toolResult["arguments_schema_version"])),
			},
			"source_ids": workflowSourceIDs(result),
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
