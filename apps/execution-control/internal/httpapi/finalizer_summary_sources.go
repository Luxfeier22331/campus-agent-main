package httpapi

func workflowSummarySourceIDs(
	result map[string]any,
	capabilityObservability map[string]any,
) []string {
	sourceIDs := workflowSourceIDs(result)
	if len(sourceIDs) > 0 {
		return sourceIDs
	}
	safeDetails := workflowSafeDetails(capabilityObservability)
	sourceRefsUsed := stringArrayValue(safeDetails["source_refs_used"])
	if len(sourceRefsUsed) == 0 {
		return []string{}
	}
	unique := make([]string, 0, len(sourceRefsUsed))
	for _, sourceID := range sourceRefsUsed {
		appendWorkflowSourceID(&unique, sourceID)
	}
	return unique
}

func workflowSafeDetails(capabilityObservability map[string]any) map[string]any {
	safeDetails, _ := capabilityObservability["safe_details"].(map[string]any)
	if hasForbiddenWorkflowTraceKey(safeDetails) {
		return map[string]any{}
	}
	return safeWorkflowMap(safeDetails)
}
