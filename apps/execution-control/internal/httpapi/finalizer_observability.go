package httpapi

import "strings"

func normalizeWorkflowTraceKeyToken(value string) string {
	var builder strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func allowedCapabilityID(target string) bool {
	switch target {
	case "knowledge", "navigation", "campus_services", "notice":
		return true
	default:
		return false
	}
}

func allowedDelegateStatus(status string) bool {
	switch status {
	case "completed", "needs_clarification", "no_answer", "error":
		return true
	default:
		return false
	}
}

func allowedConfidence(confidence string) bool {
	switch confidence {
	case "high", "medium", "low":
		return true
	default:
		return false
	}
}

func buildExecutionObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	if target == "knowledge" {
		return buildRagExecutionObservability(status, result, selectedTool)
	}
	return buildStructuredExecutionObservability(target, status, result, selectedTool)
}

func buildRagExecutionObservability(
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	diagnostics := nestedMap(result, "diagnostics")
	evidence := nestedMap(result, "evidence")
	supportingSources := arrayValue(evidence["sources"])
	retrievedSources := arrayValue(diagnostics["retrieved_sources"])
	sourceCount := len(retrievedSources)
	retrievalAttempted := any(nil)
	switch status {
	case "completed":
		retrievalAttempted = true
	case "error":
		retrievalAttempted = sourceCount > 0 || stringValue(diagnostics["fail_close_reason"]) != ""
	case "no_answer":
		retrievalAttempted = stringValue(diagnostics["no_answer_reason"]) != "curriculum_course_map_unsupported" ||
			stringValue(diagnostics["fail_close_reason"]) != ""
	case "needs_clarification":
		retrievalAttempted = sourceCount > 0
	}
	citationExpected := status == "completed"
	citationCount := 0
	if citationExpected {
		citationCount = len(supportingSources)
	}
	denied := stringValue(diagnostics["no_answer_reason"]) == "restricted_access_denied" ||
		stringValue(diagnostics["semantic_outcome"]) == "restricted_access_denied"
	freshnessFailClosed, _ := diagnostics["freshness_fail_closed"].(bool)
	failCloseReason := stringValue(diagnostics["fail_close_reason"])
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
		"fail_closed":            denied || freshnessFailClosed || failCloseReason != "" || status == "error",
		"fail_close_reason":      defaultString(failCloseReason, stringValue(diagnostics["no_answer_reason"])),
		"prompt_runtime_state":   stringValue(diagnostics["prompt_runtime_state"]),
		"prompt_runtime_detail":  stringValue(diagnostics["prompt_runtime_detail"]),
		"resolved_scope_corpus":  optionalStringValue(diagnostics["resolved_scope_corpus"]),
		"resolved_scope_collection": stringValue(
			diagnostics["resolved_scope_collection"],
		),
		"selected_tool": selectedTool,
		"prompt_trace":  diagnostics["prompt_trace"],
	}
}

func buildStructuredExecutionObservability(
	target string,
	status string,
	result map[string]any,
	selectedTool string,
) map[string]any {
	tool := selectedTool
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
	if status == "error" {
		return "runtime_error"
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
	case "knowledge", "navigation", "campus_services", "notice":
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

func candidateCountForTool(tool string, result map[string]any) int {
	switch tool {
	case "campus_notice_discover":
		return len(arrayValue(result["notice_cards"]))
	case "transport_schedule_lookup":
		return len(arrayValue(result["candidate_routes"]))
	case "service_guide_lookup":
		return len(arrayValue(result["candidate_services"]))
	case "contact_directory_lookup":
		return len(arrayValue(result["candidate_contacts"]))
	case "place_lookup":
		return len(arrayValue(result["candidate_places"]))
	default:
		return 0
	}
}

func noticeSourceFamilySummary(result map[string]any) string {
	families := []string{}
	collectNoticeSourceFamiliesFromValue(result, &families)
	return joinStrings(families, ",")
}

func collectNoticeSourceFamiliesFromValue(value any, families *[]string) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			switch key {
			case "source_family", "sourceFamily":
				appendNoticeSourceFamily(families, stringValue(item))
			case "source_families", "sourceFamilies":
				for _, family := range stringArrayValue(item) {
					appendNoticeSourceFamily(families, family)
				}
			case "source_ref", "sourceRef":
				appendNoticeSourceFamily(families, noticeSourceFamilyFromRef(stringValue(item)))
			case "source_refs", "sourceRefs", "related_notice_refs", "relatedNoticeRefs",
				"override_source_refs", "overrideSourceRefs", "notice_refs", "noticeRefs":
				for _, ref := range stringArrayValue(item) {
					appendNoticeSourceFamily(families, noticeSourceFamilyFromRef(ref))
				}
			}
			collectNoticeSourceFamiliesFromValue(item, families)
		}
	case []any:
		for _, item := range current {
			collectNoticeSourceFamiliesFromValue(item, families)
		}
	}
}

func appendNoticeSourceFamily(families *[]string, family string) {
	normalized := strings.TrimSpace(family)
	if normalized == "" || containsString(*families, normalized) {
		return
	}
	*families = append(*families, normalized)
}

func noticeSourceFamilyFromRef(ref string) string {
	normalized := strings.ToLower(strings.TrimSpace(ref))
	switch {
	case strings.HasPrefix(normalized, "authenticated_notice:"),
		strings.HasPrefix(normalized, "notice:muc_internal_portal:"),
		strings.HasPrefix(normalized, "notice:internal_notice_restricted:"):
		return "internal_notice_restricted"
	case strings.HasPrefix(normalized, "official_web:"),
		strings.HasPrefix(normalized, "notice:official_web:"):
		return "official_web_public_notice"
	case strings.HasPrefix(normalized, "wechat_public_notice:"),
		strings.HasPrefix(normalized, "notice:wechat_public_notice:"):
		return "wechat_public_notice"
	default:
		return ""
	}
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
