package runtimepolicy

import "strings"

func PrimaryAgentVisibleToolNames(
	visibleToolNames []string,
	requestedTool string,
	userGoal string,
	policy IntentPolicyArtifact,
) []string {
	visible := normalizedToolNames(visibleToolNames)
	if len(visible) == 0 {
		return nil
	}
	if strings.TrimSpace(requestedTool) != "" {
		return visible
	}
	if !hasToolName(visible, "knowledge_query") {
		return visible
	}
	normalizedGoal := NormalizeGoal(userGoal)
	if normalizedGoal == "" {
		return visible
	}
	if firstMatch(normalizedGoal, policy.Signals("institutional_account_knowledge")) == "" {
		return visible
	}
	return []string{"knowledge_query"}
}

func normalizedToolNames(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func hasToolName(values []string, toolName string) bool {
	for _, value := range values {
		if value == toolName {
			return true
		}
	}
	return false
}
