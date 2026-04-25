package httpapi

import (
	"errors"
	"strings"
)

var errInvalidAgentResponse = errors.New("invalid agent response")

func finalizeAgentBridgeResponse(
	agentResponse map[string]any,
	traceID string,
	selectedTool string,
) (map[string]any, error) {
	target := stringValue(agentResponse["target"])
	if target == "" {
		target = stringValue(agentResponse["selected_target"])
	}
	status := stringValue(agentResponse["status"])
	if target == "" || !allowedDelegateStatus(status) {
		return nil, errInvalidAgentResponse
	}
	result, _ := agentResponse["result"].(map[string]any)
	response := map[string]any{
		"selected_target":    target,
		"status":             status,
		"answer_text":        stringValue(agentResponse["answer_text"]),
		"follow_up_question": stringValue(agentResponse["follow_up_question"]),
		"confidence":         defaultString(stringValue(agentResponse["confidence"]), "low"),
		"result":             agentResponse["result"],
		"error":              agentResponse["error"],
		"observability":      buildSupervisorObservability(target, status, result, selectedTool),
		"trace_id":           traceID,
	}
	return response, nil
}

func allowedDelegateStatus(status string) bool {
	switch status {
	case "completed", "needs_clarification", "no_answer", "error":
		return true
	default:
		return false
	}
}

func buildSupervisorObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	if target == "rag-agent" {
		return buildRagSupervisorObservability(status, result)
	}
	return buildStructuredSupervisorObservability(target, status, result, selectedTool)
}

func buildRagSupervisorObservability(status string, result map[string]any) map[string]any {
	diagnostics := nestedMap(result, "diagnostics")
	evidence := nestedMap(result, "evidence")
	supportingSources := arrayValue(evidence["sources"])
	retrievedSources := arrayValue(diagnostics["retrieved_sources"])
	sourceCount := len(retrievedSources)
	retrievalAttempted := any(nil)
	switch status {
	case "completed":
		retrievalAttempted = true
	case "no_answer":
		retrievalAttempted = stringValue(diagnostics["no_answer_reason"]) != "curriculum_course_map_unsupported"
	case "needs_clarification":
		retrievalAttempted = sourceCount > 0
	}
	citationExpected := status == "completed"
	citationCount := 0
	if citationExpected {
		citationCount = len(supportingSources)
	}
	denied := stringValue(diagnostics["no_answer_reason"]) == "restricted_access_denied"
	freshnessFailClosed, _ := diagnostics["freshness_fail_closed"].(bool)
	return map[string]any{
		"retrieval_attempted":    retrievalAttempted,
		"candidate_count":        sourceCount,
		"retrieved_source_count": sourceCount,
		"retrieved_sources":      retrievedSources,
		"citation_expected":      citationExpected,
		"citation_count":         citationCount,
		"citation_missing":       citationExpected && citationCount == 0,
		"refusal_class":          refusalClassForAgentStatus(status),
		"semantic_outcome":       ragSemanticOutcome(status, diagnostics),
		"scope_class":            "in_scope",
		"acl_decision":           aclDecision(denied),
		"fail_closed":            denied || freshnessFailClosed,
		"prompt_runtime_state":   stringValue(diagnostics["prompt_runtime_state"]),
		"prompt_runtime_detail":  stringValue(diagnostics["prompt_runtime_detail"]),
		"resolved_scope_corpus":  optionalStringValue(diagnostics["resolved_scope_corpus"]),
		"resolved_scope_collection": stringValue(
			diagnostics["resolved_scope_collection"],
		),
		"prompt_trace": diagnostics["prompt_trace"],
	}
}

func buildStructuredSupervisorObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	tool := defaultString(selectedTool, inferSelectedTool(target, result))
	outcome := stringValue(result["outcome"])
	failCloseReason := stringValue(result["fail_close_reason"])
	return map[string]any{
		"retrieval_attempted":              false,
		"candidate_count":                  candidateCountForTool(tool, result),
		"retrieved_source_count":           0,
		"retrieved_sources":                []any{},
		"citation_expected":                false,
		"citation_count":                   0,
		"citation_missing":                 false,
		"refusal_class":                    refusalClassForAgentStatus(status),
		"semantic_outcome":                 structuredSemanticOutcome(status, outcome),
		"scope_class":                      scopeClassForTarget(target),
		"acl_decision":                     "allowed",
		"fail_closed":                      failCloseReason != "",
		"selected_tool":                    tool,
		"tool_business_outcome":            outcome,
		"tool_fail_close_reason":           failCloseReason,
		"tool_historical_downgrade_reason": stringValue(result["historical_downgrade_reason"]),
		"service_guide_focus":              stringValue(result["guide_focus"]),
		"matched_service_category":         stringValue(result["matched_service_category"]),
		"notice_source_family_summary":     noticeSourceFamilySummary(result),
		"temporal_posture":                 temporalPosture(result),
	}
}

func ragSemanticOutcome(status string, diagnostics map[string]any) string {
	if semanticOutcome := stringValue(diagnostics["semantic_outcome"]); semanticOutcome != "" {
		return semanticOutcome
	}
	if status == "completed" {
		return "grounded_answer"
	}
	if status == "needs_clarification" {
		return "needs_clarification"
	}
	if status != "no_answer" {
		return ""
	}
	if stringValue(diagnostics["no_answer_reason"]) == "restricted_access_denied" {
		return "restricted_access_denied"
	}
	return "unsupported_by_evidence"
}

func structuredSemanticOutcome(status string, outcome string) string {
	if outcome != "" {
		return outcome
	}
	if status == "needs_clarification" {
		return "needs_clarification"
	}
	if status == "no_answer" {
		return "temporarily_unverifiable"
	}
	return ""
}

func refusalClassForAgentStatus(status string) string {
	if status == "needs_clarification" || status == "no_answer" {
		return status
	}
	return ""
}

func scopeClassForTarget(target string) string {
	switch target {
	case "rag-agent", "navigation-agent", "campus-services-agent", "notice-agent":
		return "in_scope"
	default:
		return ""
	}
}

func aclDecision(denied bool) string {
	if denied {
		return "denied"
	}
	return "allowed"
}

func inferSelectedTool(target string, result map[string]any) string {
	switch {
	case target == "navigation-agent":
		return "place_lookup"
	case target == "notice-agent" && stringValue(result["notice_id"]) != "":
		return "campus_notice_get"
	case target == "notice-agent":
		return "campus_notice_discover"
	case stringValue(result["guide_focus"]) != "":
		return "service_guide_lookup"
	case stringValue(result["intent"]) != "":
		return "transport_schedule_lookup"
	case stringValue(result["subject_query"]) != "":
		return "service_status_lookup"
	default:
		return ""
	}
}

func candidateCountForTool(tool string, result map[string]any) int {
	switch tool {
	case "campus_notice_discover":
		return len(arrayValue(result["notice_cards"]))
	case "transport_schedule_lookup":
		return len(arrayValue(result["candidate_routes"]))
	case "service_guide_lookup":
		return len(arrayValue(result["candidate_services"]))
	case "place_lookup":
		return len(arrayValue(result["candidate_places"]))
	default:
		return 0
	}
}

func noticeSourceFamilySummary(result map[string]any) string {
	if sourceFamily := stringValue(result["source_family"]); sourceFamily != "" {
		return sourceFamily
	}
	families := stringArrayValue(result["source_families"])
	if len(families) == 0 {
		for _, rawCard := range arrayValue(result["notice_cards"]) {
			card, ok := rawCard.(map[string]any)
			if !ok {
				continue
			}
			family := stringValue(card["source_family"])
			if family != "" && !containsString(families, family) {
				families = append(families, family)
			}
		}
	}
	return joinStrings(families, ",")
}

func temporalPosture(result map[string]any) string {
	if stringValue(result["outcome"]) == "resolved_historical_reference" {
		return "historical_reference"
	}
	return "current"
}

func arrayValue(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return []any{}
	}
	return items
}

func stringArrayValue(value any) []string {
	items := arrayValue(value)
	values := make([]string, 0, len(items))
	for _, item := range items {
		text := stringValue(item)
		if text != "" {
			values = append(values, text)
		}
	}
	return values
}

func optionalStringValue(value any) any {
	text := stringValue(value)
	if text == "" {
		return nil
	}
	return text
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func joinStrings(values []string, separator string) string {
	return strings.Join(values, separator)
}
