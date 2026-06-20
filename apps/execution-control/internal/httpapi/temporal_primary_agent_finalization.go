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
	completedRun, err := s.runProjectionStore.CompleteRunProjection(
		ctx,
		execution.DurableRunCompleteRequest{
			FinalResponseRef: finalizationRef,
			Now:              completedAt,
			RunID:            run.RunID,
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
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		SelectedCapability: selectedCapability,
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
			"workflow_mode":             "agent_loop",
			"selected_capability":       selectedCapability,
			"selected_tools":            selectedTools,
			"direct_vs_delegate_branch": primaryAgentTraceBranch(terminalKind),
			"terminal_reason":           terminalKind,
			"answer_artifact_kinds":     []string{"agent_final_output"},
			"answer_artifact_refs":      []string{strings.TrimSpace(stringValue(agentResult["agent_result_ref"]))},
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

func primaryAgentTraceBranch(terminalReason string) string {
	switch terminalReason {
	case "clarification_required":
		return "clarification"
	case "out_of_scope":
		return "out_of_scope"
	case "policy_refusal":
		return "policy_refusal"
	case "unsupported_by_evidence":
		return "unsupported"
	case "tool_selected":
		return "tool"
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
		return "primary_agent"
	}
	for _, tool := range selectedTools {
		switch tool {
		case "service_status_lookup",
			"service_guide_lookup",
			"transport_schedule_lookup",
			"contact_directory_lookup",
			"academic_calendar_lookup":
			return "campus_services"
		case "campus_notice_change_set_lookup", "campus_notice_discover", "campus_notice_period_summary":
			return "notice"
		case "knowledge_query":
			return "knowledge"
		}
	}
	return "primary_agent"
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
