package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func projectedPlanningForEval(results []execution.StepResultProjection) map[string]any {
	planning := map[string]any{}
	if plannedSteps := projectedPlanningStepsFromRuntimeResults(results); len(plannedSteps) > 0 {
		planning["planned_steps"] = stringsToAny(plannedSteps)
	}
	for _, result := range results {
		if !strings.HasPrefix(result.StepID, "knowledge.search.") {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		resolvedVersion := optionalMapFromMap(payload, "resolved_version")
		mode := firstNonEmptyText(resolvedVersion["mode"])
		if mode != "" {
			planning["freshness_branch"] = mode
		}
		if scope := firstNonEmptyText(payload["resolved_scope"]); scope != "" {
			planning["decomposition"] = stringsToAny(projectedPlanningDecomposition(scope, mode, resolvedVersion))
		}
		break
	}
	return planning
}

func projectedPlanningDecomposition(scope string, mode string, resolvedVersion map[string]any) []string {
	decomposition := []string{scope}
	switch mode {
	case "current":
		decomposition = append(decomposition, "current")
	case "historical":
		if versionID := firstNonEmptyText(resolvedVersion["version_id"]); versionID != "" {
			decomposition = append(decomposition, "historical:"+versionID)
		} else {
			decomposition = append(decomposition, "historical")
		}
	case "as_of":
		if asOf := firstNonEmptyText(resolvedVersion["as_of"]); asOf != "" {
			decomposition = append(decomposition, "as_of:"+asOf)
		} else {
			decomposition = append(decomposition, "as_of")
		}
	case "compare":
		versionID := firstNonEmptyText(resolvedVersion["version_id"])
		compareTo := firstNonEmptyText(resolvedVersion["compare_to_version_id"])
		if versionID != "" && compareTo != "" {
			decomposition = append(decomposition, "compare:"+versionID+":"+compareTo)
		} else {
			decomposition = append(decomposition, "compare")
		}
	}
	return decomposition
}

func projectedPlanningStepsFromRuntimeResults(results []execution.StepResultProjection) []string {
	steps := []string{}
	if hasStepResult(results, "agent.primary") {
		appendUniqueProjectionString(&steps, "agent.primary")
	}
	for _, result := range results {
		if strings.HasPrefix(result.StepID, "knowledge.search.") {
			appendUniqueProjectionString(&steps, "knowledge.search")
			break
		}
	}
	if hasStepResult(results, "finalization.write") {
		appendUniqueProjectionString(&steps, "finalization.write")
	}
	return steps
}

func hasStepResult(results []execution.StepResultProjection, stepID string) bool {
	for _, result := range results {
		if result.StepID == stepID {
			return true
		}
	}
	return false
}

func projectedRAGForEval(results []execution.StepResultProjection) map[string]any {
	rag := map[string]any{}
	if titles := projectedRAGSourceTitles(results); len(titles) > 0 {
		rag["source_titles"] = titles
	}
	if refs := projectedRAGSourceRefs(results); len(refs) > 0 {
		rag["source_refs"] = refs
	}
	return rag
}

func projectedRAGSourceTitles(results []execution.StepResultProjection) []any {
	values := []string{}
	for _, result := range results {
		if result.StepID != "finalization.write" {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		for _, source := range projectedRAGSourcesFromPayload(payload) {
			appendUniqueProjectionString(&values, firstNonEmptyText(
				source["canonical_source_title"],
				source["source_title"],
				source["title"],
			))
		}
	}
	return stringsToAny(values)
}

func projectedRAGSourceRefs(results []execution.StepResultProjection) []any {
	values := []map[string]any{}
	seen := map[string]struct{}{}
	for _, result := range results {
		if result.StepID != "finalization.write" {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		for _, source := range projectedRAGSourcesFromPayload(payload) {
			ref := map[string]any{}
			copyProjectionString(ref, source, "canonical_url", "canonical_url")
			copyProjectionString(ref, source, "canonical_source_title", "canonical_source_title")
			copyProjectionString(ref, source, "source_title", "source_title")
			copyProjectionString(ref, source, "title", "title")
			copyProjectionString(ref, source, "source_kind", "source_kind")
			copyProjectionString(ref, source, "target_kind", "target_kind")
			copyProjectionString(ref, source, "url", "url")
			copyProjectionString(ref, source, "version_id", "version_id")
			key := firstNonEmptyText(
				ref["canonical_url"],
				ref["url"],
				ref["source_title"],
				ref["title"],
			)
			if key == "" {
				continue
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			values = append(values, ref)
		}
	}
	return mapsToAny(values)
}

func projectedRAGSourcesFromPayload(payload map[string]any) []map[string]any {
	finalized := optionalMapFromMap(payload, "finalized_response")
	result := optionalMapFromMap(finalized, "result")
	return mapListFromAny(result["sources"])
}

func projectedMemoryForEval(results []execution.StepResultProjection) map[string]any {
	explicit := projectedRecordFromResults(results, "memory")
	if len(explicit) > 0 {
		return explicit
	}
	projected := projectedPersonalMemoryForEval(results)
	if len(projected) > 0 {
		return projected
	}
	for _, result := range results {
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		contextUsage := optionalMapFromMap(payload, "context_usage")
		if len(contextUsage) == 0 && result.StepID == "agent.primary" {
			contextUsage = payload
		}
		if len(contextUsage) == 0 {
			continue
		}
		observedTokens := []string{}
		if intFromProjection(contextUsage["previous_evidence_count"]) > 0 {
			observedTokens = append(observedTokens, "previous_evidence_ref")
		}
		if intFromProjection(contextUsage["previous_evidence_source_hash_count"]) > 0 ||
			intFromProjection(contextUsage["previous_evidence_count"]) > 0 {
			observedTokens = append(observedTokens, "source_hash")
		}
		if len(observedTokens) == 0 {
			continue
		}
		return map[string]any{
			"behavior":        "previous_evidence_reuse",
			"observed_tokens": stringsToAny(observedTokens),
		}
	}
	return map[string]any{}
}

func projectedPersonalMemoryForEval(results []execution.StepResultProjection) map[string]any {
	memory := map[string]any{}
	observedTokens := []string{}
	for _, result := range results {
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		switch result.StepID {
		case "memory.recall":
			projectMemoryRecallEvalSummary(memory, &observedTokens, result, payload)
		case "memory.reflect":
			projectMemoryReflectEvalSummary(memory, &observedTokens, result, payload)
		}
	}
	if len(memory) == 0 {
		return map[string]any{}
	}
	if len(observedTokens) > 0 {
		memory["observed_tokens"] = stringsToAny(observedTokens)
	}
	if _, exists := memory["behavior"]; !exists {
		memory["behavior"] = "personal_memory"
	}
	return memory
}

func projectMemoryRecallEvalSummary(memory map[string]any, observedTokens *[]string, result execution.StepResultProjection, payload map[string]any) {
	status := firstNonEmptyText(payload["status"], result.Status)
	if status == "" {
		return
	}
	memory["behavior"] = "personal_memory_recall"
	memory["recall_status"] = status
	appendUniqueProjectionString(observedTokens, "memory_recall")
	selectedCount := intFromProjection(payload["selected_memory_count"])
	selectedChars := intFromProjection(payload["selected_memory_chars"])
	if selectedCount > 0 {
		memory["selected_memory_count"] = selectedCount
		appendUniqueProjectionString(observedTokens, "selected_memory")
	}
	if selectedChars > 0 {
		memory["selected_memory_chars"] = selectedChars
	}
	if skippedCount := intFromProjection(payload["skipped_count"]); skippedCount > 0 {
		memory["skipped_memory_count"] = skippedCount
	}
}

func projectMemoryReflectEvalSummary(memory map[string]any, observedTokens *[]string, result execution.StepResultProjection, payload map[string]any) {
	status := firstNonEmptyText(payload["status"], result.Status)
	if status == "" {
		return
	}
	if _, exists := memory["behavior"]; !exists {
		memory["behavior"] = "personal_memory_reflect"
	}
	memory["reflect_status"] = status
	appendUniqueProjectionString(observedTokens, "memory_reflect")
	basedOnCount := len(mapListFromAny(payload["based_on_memory_context_items"]))
	if basedOnCount > 0 {
		memory["reflect_based_on_count"] = basedOnCount
		appendUniqueProjectionString(observedTokens, "reflect_based_on_facts")
	}
}

func copyProjectionString(target map[string]any, source map[string]any, targetKey string, sourceKey string) {
	if value := firstNonEmptyText(source[sourceKey]); value != "" {
		target[targetKey] = value
	}
}

func appendUniqueProjectionString(values *[]string, value string) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return
	}
	for _, current := range *values {
		if current == normalized {
			return
		}
	}
	*values = append(*values, normalized)
}

func stringsToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func mapsToAny(values []map[string]any) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func mapListFromAny(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if ok {
			items = append(items, sanitizeProjectionPayload(item))
		}
	}
	return items
}

func intFromProjection(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}
