package runtimepolicy

import "strings"

func PrimaryAgentVisibleCapabilities(
	visibleCapabilities []string,
	requestedCapability string,
	userGoal string,
	policy IntentPolicyArtifact,
) []string {
	visible := normalizedCapabilities(visibleCapabilities)
	if len(visible) == 0 {
		return nil
	}
	if strings.TrimSpace(requestedCapability) != "" {
		return visible
	}
	if !hasCapability(visible, "knowledge") {
		return visible
	}
	normalizedGoal := NormalizeGoal(userGoal)
	if normalizedGoal == "" {
		return visible
	}
	if firstMatch(normalizedGoal, policy.Signals("institutional_account_knowledge")) == "" {
		return visible
	}
	return []string{"knowledge"}
}

func normalizedCapabilities(values []string) []string {
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

func hasCapability(values []string, capability string) bool {
	for _, value := range values {
		if value == capability {
			return true
		}
	}
	return false
}
