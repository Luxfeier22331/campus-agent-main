package runtimepolicy

import "strings"

func evaluatePolicyReason(normalizedGoal string, policy IntentPolicyArtifact) string {
	if isTargetedPoliticalPersuasion(normalizedGoal, policy) {
		return "political_persuasion"
	}
	return ""
}

func isHighRiskTransactionAction(normalizedGoal string, policy IntentPolicyArtifact) bool {
	for _, prefix := range policy.Signals("delegated_action_prefix") {
		if !strings.Contains(normalizedGoal, NormalizeGoal(prefix)) {
			continue
		}
		if containsAny(normalizedGoal, policy.Signals("high_risk_transaction_action")) {
			return true
		}
	}
	return false
}

func isTargetedPoliticalPersuasion(normalizedGoal string, policy IntentPolicyArtifact) bool {
	if !containsAny(normalizedGoal, policy.Signals("political_topic")) {
		return false
	}
	hasInfluence := containsAny(normalizedGoal, policy.Signals("political_influence_action"))
	hasAudience := containsAny(normalizedGoal, policy.Signals("political_target_audience"))
	hasPosition := containsAny(normalizedGoal, policy.Signals("political_position"))
	hasWriting := containsAny(normalizedGoal, policy.Signals("political_message_writing"))
	if hasInfluence && (hasAudience || hasPosition) {
		return true
	}
	return hasWriting && hasInfluence
}

func matchToolReadModelCandidate(normalizedGoal string, policy IntentPolicyArtifact) string {
	if signal := matchTransportScheduleToolCandidate(normalizedGoal, policy); signal != "" {
		return signal
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("tool_notice")); signal != "" {
		return signal
	}
	return ""
}

func isPlannableCampusServicesSubtype(normalizedGoal string, policy IntentPolicyArtifact) bool {
	return matchTransportScheduleToolCandidate(normalizedGoal, policy) != ""
}

func IsTransportScheduleLookupQueryForPlanning(
	normalizedGoal string,
	policy IntentPolicyArtifact,
) bool {
	return matchTransportScheduleToolCandidate(normalizedGoal, policy) != ""
}

func matchTransportScheduleToolCandidate(normalizedGoal string, policy IntentPolicyArtifact) string {
	signal := firstMatch(normalizedGoal, policy.Signals("tool_transport"))
	if signal == "" {
		return ""
	}
	if isTransportScheduleLookupQuery(normalizedGoal, policy) {
		return signal
	}
	return ""
}

func isTransportScheduleLookupQuery(normalizedGoal string, policy IntentPolicyArtifact) bool {
	if containsAny(normalizedGoal, policy.Signals("tool_transport_boarding_status")) {
		return true
	}
	for _, group := range []string{
		"transport_intent_departure_list",
		"transport_intent_first_departure",
		"transport_intent_last_departure",
		"transport_intent_service_window",
		"transport_intent_snapshot_metadata",
		"transport_intent_timetable",
	} {
		if containsAny(normalizedGoal, policy.Signals(group)) {
			return true
		}
	}
	if strings.Contains(normalizedGoal, "发车") ||
		strings.Contains(normalizedGoal, "班次") ||
		strings.Contains(normalizedGoal, "几点") ||
		strings.Contains(normalizedGoal, "什么时候") {
		return true
	}
	if strings.Contains(normalizedGoal, "还有") &&
		(strings.Contains(normalizedGoal, "车") || strings.Contains(normalizedGoal, "班")) {
		return true
	}
	if strings.Contains(normalizedGoal, "跑") &&
		(strings.Contains(normalizedGoal, "还") || strings.Contains(normalizedGoal, "停")) {
		return true
	}
	return false
}

func matchOpenDomainPoliticalFact(normalizedGoal string, policy IntentPolicyArtifact) string {
	if !containsAny(normalizedGoal, policy.Signals("geopolitical_entity")) {
		return ""
	}
	return firstMatch(normalizedGoal, policy.Signals("political_office"))
}

func firstContextSignal(context Context, policy IntentPolicyArtifact) string {
	for _, candidate := range previousGoalContextCandidates(context, policy) {
		if signal := firstMatch(NormalizeGoal(candidate), policy.Signals("campus_scope")); signal != "" {
			return signal
		}
	}
	return ""
}

func previousGoalContextCandidates(context Context, policy IntentPolicyArtifact) []string {
	candidates := []string{}
	seen := map[string]struct{}{}
	for _, slot := range context.SessionSlots {
		if !slot.Confirmed {
			continue
		}
		value := strings.TrimSpace(slot.Value)
		if value == "" {
			continue
		}
		if firstMatch(NormalizeGoal(value), policy.Signals("campus_scope")) == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}
	return candidates
}

func looksLikeContextualSemesterFollowUp(normalizedGoal string, policy IntentPolicyArtifact) bool {
	if strings.HasSuffix(normalizedGoal, "呢") || len([]rune(normalizedGoal)) <= 6 {
		return true
	}
	return containsAny(normalizedGoal, policy.Signals("follow_up_leading"))
}

func sessionSlotValue(slots []SessionSlot, name string) string {
	for _, slot := range slots {
		if !slot.Confirmed {
			continue
		}
		if slot.Name == name {
			return slot.Value
		}
	}
	return ""
}

func NormalizeGoal(userGoal string) string {
	return strings.ToLower(strings.Join(strings.Fields(userGoal), ""))
}

func firstMatch(normalizedValue string, signals []string) string {
	for _, signal := range signals {
		normalizedSignal := NormalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(normalizedValue, normalizedSignal) {
			return signal
		}
	}
	return ""
}

func containsAny(normalizedValue string, signals []string) bool {
	return firstMatch(normalizedValue, signals) != ""
}

func defaultString(value string, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}
