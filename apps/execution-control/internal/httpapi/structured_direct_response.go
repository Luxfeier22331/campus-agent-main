package httpapi

import "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"

func shapeStructuredExecutionResponse(
	target string,
	payloadKind string,
	result map[string]any,
	traceID string,
	context executionFinalizerContext,
) map[string]any {
	outcome := stringValue(result["outcome"])
	status := executionStatusForStructuredOutcome(outcome)
	answerText := structuredAnswerText(payloadKind, result, status)
	executionResponse, err := finalizeCapabilityResponse(
		map[string]any{
			"capability":               target,
			"status":                   status,
			"answer_text":              answerText,
			"follow_up_question":       "",
			"confidence":               confidenceForStructuredOutcome(outcome),
			"result":                   result,
			"error":                    nil,
			"capability_observability": structuredDirectCapabilityObservability(target, payloadKind, result),
		},
		traceID,
		structuredFinalizerContext(context, payloadKind),
	)
	if err != nil {
		return map[string]any{
			"selected_capability": target,
			"status":              "error",
			"answer_text":         "结构化查询结果未通过 execution finalization。",
			"follow_up_question":  "",
			"confidence":          "low",
			"result":              result,
			"error": map[string]any{
				"code":      "structured_finalization_failed",
				"message":   "structured execution finalization invariant failed",
				"retryable": false,
			},
			"observability": map[string]any{
				"fail_closed":       true,
				"fail_close_reason": "structured_finalization_failed",
				"selected_tool":     payloadKind,
			},
			"workflow_trace_summary": workflowTraceSummaryWireMap(buildWorkflowTraceSummaryWire(
				executionFinalizerContext{
					SelectedTool: payloadKind,
					RuntimeDecisions: execution.RuntimeDecisionSummary{
						FailCloseReason: "structured_finalization_failed",
					},
					Branch: "direct",
				},
				target,
				"error",
				map[string]any{
					"fail_close_reason": "structured_finalization_failed",
				},
				map[string]any{
					"selected_tool":     payloadKind,
					"fail_close_reason": "structured_finalization_failed",
				},
			)),
			"trace_id": traceID,
		}
	}
	return executionResponse
}

func structuredDirectCapabilityObservability(
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
			"capability_execution_projection": map[string]any{
				"schema_version":        "capability-execution-projection-v1",
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
	context executionFinalizerContext,
	payloadKind string,
) executionFinalizerContext {
	if context.SelectedTool == "" {
		context.SelectedTool = payloadKind
	}
	if context.Branch == "" {
		context.Branch = "direct"
	}
	return context
}

func executionStatusForStructuredOutcome(outcome string) string {
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
