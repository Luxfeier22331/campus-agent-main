package structuredplanning

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"strings"
)

func isNoticeKnowledgeFollowthrough(
	normalizedGoal string,
	request Request,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return request.MultiStepWorkflowEnabled &&
		request.HasRequestedScope &&
		request.SelectedNoticeRef.NoticeID != "" &&
		isEligibleNoticeKnowledgeFollowthroughTargetSurface(request.SelectedNoticeRef.TargetSurface) &&
		containsAny(normalizedGoal, policy.Signals("notice_get_reference")) &&
		containsAny(normalizedGoal, policy.Signals("notice_knowledge_followthrough"))
}

func isEligibleNoticeKnowledgeFollowthroughTargetSurface(targetSurface string) bool {
	switch targetSurface {
	case "regulations/student_rules", "regulations/institutional_rules", "regulations/scoped_rules":
		return true
	default:
		return false
	}
}

func isDelegatedTransactionAction(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) bool {
	return containsAny(normalizedGoal, policy.Signals("delegated_action_prefix")) &&
		containsAny(normalizedGoal, policy.Signals("high_risk_transaction_action"))
}

func (h Handoff) Map() map[string]any {
	return map[string]any{
		"capability":    h.Capability,
		"worker_role":   runtimepolicy.WorkerRoleForCapability(h.Capability),
		"payload_kind":  h.PayloadKind,
		"payload":       h.Payload,
		"allowed_tools": h.AllowedTools,
	}
}

func transportSchedulePayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	payload := map[string]any{
		"query_text":     userGoal,
		"intent":         classifyTransportIntent(normalizedGoal, policy),
		"snapshot_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
	}
	if routeSelector := transportRouteSelectorPayload(normalizedGoal, policy); len(routeSelector) > 0 {
		payload["route_selector"] = routeSelector
	}
	if serviceTimeQuery := transportServiceTimeQueryPayload(normalizedGoal, policy); len(serviceTimeQuery) > 0 {
		payload["service_time_query"] = serviceTimeQuery
	}
	return payload
}

func noticeDiscoverPayload(
	userGoal string,
	normalizedGoal string,
	versionQuery VersionQuery,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	return map[string]any{
		"query_text":     userGoal,
		"temporal_query": temporalQueryPayload(versionQuery, normalizedGoal, policy),
	}
}

func ragRequestPayload(request Request) map[string]any {
	payload := map[string]any{
		"scope":         nil,
		"version_query": versionQueryPayload(request.VersionQuery),
	}
	if request.HasRequestedScope {
		payload["scope"] = map[string]any{
			"corpus":     request.RequestedScope.Corpus,
			"collection": request.RequestedScope.Collection,
		}
	}
	return payload
}

func versionQueryPayload(versionQuery VersionQuery) map[string]any {
	payload := map[string]any{
		"mode": defaultString(versionQuery.Mode, "current"),
	}
	if versionQuery.AsOf != "" {
		payload["as_of"] = versionQuery.AsOf
	}
	if versionQuery.VersionID != "" {
		payload["version_id"] = versionQuery.VersionID
	}
	if versionQuery.CompareToVersionID != "" {
		payload["compare_to_version_id"] = versionQuery.CompareToVersionID
	}
	return payload
}

func classifyTransportIntent(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) string {
	if containsAny(normalizedGoal, policy.Signals("transport_intent_timetable")) {
		if containsAny(normalizedGoal, policy.Signals("transport_intent_snapshot_metadata")) {
			return "schedule_snapshot_metadata"
		}
		return "timetable"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_first_departure")) {
		return "first_departure"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_last_departure")) {
		return "last_departure"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_departure_list")) {
		return "departure_list"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_intent_service_window")) {
		return "service_window"
	}
	return "next_departure"
}

func transportRouteSelectorPayload(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	selector := map[string]any{}
	if containsAny(normalizedGoal, policy.Signals("transport_route_metro_shuttle")) {
		selector["service_family"] = "metro_shuttle"
	} else if containsAny(normalizedGoal, policy.Signals("transport_route_intercampus_commute")) {
		selector["service_family"] = "intercampus_commute"
	}
	if containsAny(normalizedGoal, policy.Signals("transport_route_to_fengtai")) {
		selector["destination_campus"] = "fengtai"
		if containsAny(normalizedGoal, policy.Signals("campus_scope_haidian")) {
			selector["origin_campus"] = "haidian"
		}
	} else if containsAny(normalizedGoal, policy.Signals("transport_route_to_haidian")) {
		selector["destination_campus"] = "haidian"
		if containsAny(normalizedGoal, policy.Signals("campus_scope_fengtai")) {
			selector["origin_campus"] = "fengtai"
		}
	}
	return selector
}

func transportServiceTimeQueryPayload(
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	if containsAny(normalizedGoal, policy.Signals("transport_intent_timetable")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_today")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		return nil
	}
	if yearPattern.MatchString(normalizedGoal) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_today")) &&
		!containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		return nil
	}
	query := map[string]any{
		"date_mode": "today",
		"daypart":   "all_day",
	}
	if containsAny(normalizedGoal, policy.Signals("temporal_tomorrow")) {
		query["date_mode"] = "tomorrow"
	}
	if containsAny(normalizedGoal, policy.Signals("temporal_daypart_morning")) {
		query["daypart"] = "morning"
	} else if containsAny(normalizedGoal, policy.Signals("temporal_daypart_afternoon")) {
		query["daypart"] = "afternoon"
	} else if containsAny(normalizedGoal, policy.Signals("temporal_daypart_evening")) {
		query["daypart"] = "evening"
	}
	return query
}

func temporalQueryPayload(
	versionQuery VersionQuery,
	normalizedGoal string,
	policy runtimepolicy.IntentPolicyArtifact,
) map[string]any {
	if versionQuery.Mode == "as_of" {
		return map[string]any{
			"mode":  "as_of",
			"as_of": versionQuery.AsOf,
		}
	}
	if match := yearPattern.FindStringSubmatch(normalizedGoal); len(match) == 2 {
		return map[string]any{
			"mode":      "current_year",
			"year_hint": match[1],
		}
	}
	return map[string]any{"mode": "current"}
}

func containsAny(value string, signals []string) bool {
	for _, signal := range signals {
		normalizedSignal := runtimepolicy.NormalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(value, normalizedSignal) {
			return true
		}
	}
	return false
}

func defaultString(value string, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}
