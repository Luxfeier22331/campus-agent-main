package httpapi

func shapeStructuredSupervisorResponse(
	target string,
	payloadKind string,
	result map[string]any,
	traceID string,
	context supervisorFinalizerContext,
) map[string]any {
	outcome := stringValue(result["outcome"])
	status := supervisorStatusForStructuredOutcome(outcome)
	answerText := structuredAnswerText(payloadKind, result, status)
	supervisorResponse, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":              target,
			"status":              status,
			"answer_text":         answerText,
			"follow_up_question":  "",
			"confidence":          confidenceForStructuredOutcome(outcome),
			"result":              result,
			"error":               nil,
			"agent_observability": structuredDirectAgentObservability(target, payloadKind, result),
		},
		traceID,
		structuredFinalizerContext(context, payloadKind),
	)
	if err != nil {
		return map[string]any{
			"selected_target":    target,
			"status":             "no_answer",
			"answer_text":        "当前还不能稳定完成该结构化查询。",
			"follow_up_question": "",
			"confidence":         "low",
			"result":             result,
			"error":              nil,
			"trace_id":           traceID,
		}
	}
	return supervisorResponse
}

func structuredDirectAgentObservability(
	target string,
	payloadKind string,
	result map[string]any,
) map[string]any {
	outcome := stringValue(result["outcome"])
	failCloseReason := stringValue(result["fail_close_reason"])
	sourceIDs := workflowSourceIDs(result)
	sourceRefCount := len(sourceIDs)
	observability := map[string]any{
		"selected_tool":    payloadKind,
		"tool_attempted":   true,
		"tool_outcome":     outcome,
		"result_outcome":   outcome,
		"source_ref_count": sourceRefCount,
		"access_decision":  "allowed",
		"safe_details": map[string]any{
			"agent_execution_projection": map[string]any{
				"schema_version":        "agent-execution-projection-v1",
				"projection_owner":      target,
				"selected_tool":         payloadKind,
				"payload_kind":          payloadKind,
				"tool_selection_reason": "go_direct_structured_runtime",
			},
			"result_guardrail": map[string]any{
				"schema_version":   "agent-result-guardrail-v1",
				"outcome":          structuredDirectGuardrailOutcome(outcome, failCloseReason, sourceRefCount),
				"source_ref_count": sourceRefCount,
				"access_decision":  "allowed",
			},
		},
	}
	if failCloseReason != "" {
		observability["failure_class"] = failCloseReason
		observability["fail_close_reason"] = failCloseReason
	}
	return observability
}

func structuredDirectGuardrailOutcome(outcome string, failCloseReason string, sourceRefCount int) string {
	if failCloseReason != "" || outcome == "temporarily_unverifiable" {
		return "fail_closed"
	}
	if outcome == "clarification_required" {
		return "clarification_required"
	}
	if sourceRefCount > 0 {
		return "source_backed"
	}
	return "source_missing"
}

func structuredFinalizerContext(
	context supervisorFinalizerContext,
	payloadKind string,
) supervisorFinalizerContext {
	if context.SelectedTool == "" {
		context.SelectedTool = payloadKind
	}
	if context.Branch == "" {
		context.Branch = "direct"
	}
	return context
}

func supervisorStatusForStructuredOutcome(outcome string) string {
	switch outcome {
	case "resolved_current", "resolved_historical_reference":
		return "completed"
	case "clarification_required":
		return "needs_clarification"
	default:
		return "no_answer"
	}
}

func confidenceForStructuredOutcome(outcome string) string {
	if outcome == "resolved_current" || outcome == "resolved_historical_reference" {
		return "high"
	}
	return "low"
}
