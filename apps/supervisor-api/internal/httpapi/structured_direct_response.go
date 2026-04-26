package httpapi

func shapeStructuredSupervisorResponse(
	target string,
	payloadKind string,
	result map[string]any,
	traceID string,
) map[string]any {
	outcome := stringValue(result["outcome"])
	status := supervisorStatusForStructuredOutcome(outcome)
	answerText := structuredAnswerText(payloadKind, result, status)
	supervisorResponse, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":             target,
			"status":             status,
			"answer_text":        answerText,
			"follow_up_question": "",
			"confidence":         confidenceForStructuredOutcome(outcome),
			"result":             result,
			"error":              nil,
		},
		traceID,
		payloadKind,
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
