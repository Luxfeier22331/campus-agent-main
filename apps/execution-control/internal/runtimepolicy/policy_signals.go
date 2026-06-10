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

func matchStructuredRuntimeCandidate(normalizedGoal string, policy IntentPolicyArtifact) string {
	if signal := matchAcademicCalendarCandidate(normalizedGoal, policy); signal != "" {
		return signal
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("structured_transport")); signal != "" {
		return signal
	}
	if signal := matchStructuredContactDirectoryCandidate(normalizedGoal, policy); signal != "" {
		return signal
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("structured_notice")); signal != "" {
		return signal
	}
	serviceSubject := firstMatch(normalizedGoal, policy.Signals("structured_service_subject"))
	if serviceSubject == "" {
		return matchStructuredServiceGuideCandidate(normalizedGoal, policy)
	}
	if !containsAny(normalizedGoal, policy.Signals("structured_service_status")) {
		if matchStructuredServiceGuideCandidate(normalizedGoal, policy) != "" {
			return serviceSubject
		}
		return ""
	}
	return serviceSubject
}

func matchAcademicCalendarCandidate(normalizedGoal string, policy IntentPolicyArtifact) string {
	if signal := firstMatch(normalizedGoal, policy.Signals("academic_calendar_week_query")); signal != "" {
		return signal
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("academic_calendar_makeup_query")); signal != "" {
		return signal
	}
	if hasAcademicCalendarClassDayPatternQuestion(normalizedGoal) {
		return "执行课表"
	}
	if hasAcademicCalendarDateStatusQuestion(normalizedGoal) {
		return "上课"
	}
	if hasAcademicCalendarTermWindowSubject(normalizedGoal) &&
		hasAcademicCalendarTermWindowAction(normalizedGoal) {
		return "学期"
	}
	holidaySignal := firstMatch(normalizedGoal, policy.Signals("academic_calendar_holiday_query"))
	if holidaySignal == "" {
		return ""
	}
	if containsAny(normalizedGoal, policy.Signals("academic_calendar_semantic_subject")) {
		return holidaySignal
	}
	if hasAcademicCalendarHolidaySubject(normalizedGoal, policy) &&
		hasAcademicCalendarHolidayAction(normalizedGoal, policy) {
		return holidaySignal
	}
	return ""
}

func hasAcademicCalendarClassDayPatternQuestion(normalizedGoal string) bool {
	return strings.Contains(normalizedGoal, "执行") &&
		(strings.Contains(normalizedGoal, "课表") || strings.Contains(normalizedGoal, "哪天课"))
}

func hasAcademicCalendarDateStatusQuestion(normalizedGoal string) bool {
	return strings.Contains(normalizedGoal, "上课") &&
		(strings.Contains(normalizedGoal, "吗") || strings.Contains(normalizedGoal, "不上课"))
}

func hasAcademicCalendarTermWindowSubject(normalizedGoal string) bool {
	return strings.Contains(normalizedGoal, "本学期") ||
		strings.Contains(normalizedGoal, "春季学期") ||
		strings.Contains(normalizedGoal, "秋季学期")
}

func hasAcademicCalendarTermWindowAction(normalizedGoal string) bool {
	return strings.Contains(normalizedGoal, "什么时候") ||
		strings.Contains(normalizedGoal, "哪天") ||
		strings.Contains(normalizedGoal, "开始") ||
		strings.Contains(normalizedGoal, "结束") ||
		strings.Contains(normalizedGoal, "哪段时间")
}

func hasAcademicCalendarHolidaySubject(normalizedGoal string, policy IntentPolicyArtifact) bool {
	for _, signal := range policy.Signals("academic_calendar_holiday_query") {
		normalizedSignal := NormalizeGoal(signal)
		if normalizedSignal == "" || isAcademicCalendarHolidayActionSignal(normalizedSignal) {
			continue
		}
		if strings.Contains(normalizedGoal, normalizedSignal) {
			return true
		}
	}
	return false
}

func hasAcademicCalendarHolidayAction(normalizedGoal string, policy IntentPolicyArtifact) bool {
	for _, signal := range policy.Signals("academic_calendar_holiday_query") {
		normalizedSignal := NormalizeGoal(signal)
		if normalizedSignal == "" || !strings.Contains(normalizedGoal, normalizedSignal) {
			continue
		}
		if isAcademicCalendarHolidayActionSignal(normalizedSignal) {
			return true
		}
	}
	return false
}

func isAcademicCalendarHolidayActionSignal(normalizedSignal string) bool {
	return strings.Contains(normalizedSignal, "放") ||
		strings.Contains(normalizedSignal, "安排") ||
		strings.Contains(normalizedSignal, "怎么")
}

func isPlannableCampusServicesSubtype(normalizedGoal string, policy IntentPolicyArtifact) bool {
	if matchAcademicCalendarCandidate(normalizedGoal, policy) != "" || isAcademicCalendarGuideQuery(normalizedGoal) {
		return true
	}
	if firstMatch(normalizedGoal, policy.Signals("structured_transport")) != "" {
		return true
	}
	if matchStructuredContactDirectoryCandidate(normalizedGoal, policy) != "" {
		return true
	}
	if isDirectoryLookupGuideQuery(normalizedGoal) {
		return true
	}
	serviceSubject := firstMatch(normalizedGoal, policy.Signals("structured_service_subject"))
	if serviceSubject == "" {
		return matchStructuredServiceGuideCandidate(normalizedGoal, policy) != ""
	}
	return containsAny(normalizedGoal, policy.Signals("structured_service_status")) ||
		containsAny(normalizedGoal, policy.Signals("structured_service_guide_action"))
}

func matchStructuredServiceGuideCandidate(
	normalizedGoal string,
	policy IntentPolicyArtifact,
) string {
	if isDirectoryLookupGuideQuery(normalizedGoal) {
		if strings.Contains(normalizedGoal, "办公电话") {
			return "办公电话"
		}
		return "通讯录"
	}
	serviceGuideSubject := firstMatch(normalizedGoal, policy.Signals("structured_service_guide_subject"))
	if serviceGuideSubject == "" {
		return ""
	}
	if !containsAny(normalizedGoal, policy.Signals("structured_service_guide_action")) {
		return ""
	}
	return serviceGuideSubject
}

func isDirectoryLookupGuideQuery(normalizedGoal string) bool {
	if !strings.Contains(normalizedGoal, "办公电话") && !strings.Contains(normalizedGoal, "通讯录") {
		return false
	}
	return strings.Contains(normalizedGoal, "怎么查") ||
		strings.Contains(normalizedGoal, "如何查") ||
		strings.Contains(normalizedGoal, "怎么找") ||
		strings.Contains(normalizedGoal, "如何找") ||
		strings.Contains(normalizedGoal, "在哪里找") ||
		strings.Contains(normalizedGoal, "在哪找") ||
		strings.Contains(normalizedGoal, "在哪儿找")
}

func isAcademicCalendarGuideQuery(normalizedGoal string) bool {
	if !strings.Contains(normalizedGoal, "校历") {
		return false
	}
	return strings.Contains(normalizedGoal, "怎么看") ||
		strings.Contains(normalizedGoal, "如何看") ||
		strings.Contains(normalizedGoal, "在哪里看") ||
		strings.Contains(normalizedGoal, "在哪看") ||
		strings.Contains(normalizedGoal, "在哪儿看") ||
		strings.Contains(normalizedGoal, "怎么查") ||
		strings.Contains(normalizedGoal, "如何查") ||
		strings.Contains(normalizedGoal, "网址") ||
		strings.Contains(normalizedGoal, "链接")
}

func matchStructuredContactDirectoryCandidate(
	normalizedGoal string,
	policy IntentPolicyArtifact,
) string {
	contactSubject := firstMatch(normalizedGoal, policy.Signals("structured_contact_directory"))
	if contactSubject == "" {
		return ""
	}
	if !containsAny(normalizedGoal, policy.Signals("structured_contact_directory_action")) {
		return ""
	}
	return contactSubject
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
