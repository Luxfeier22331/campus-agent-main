package runtimepolicy

func evaluateScope(request Request, normalizedGoal string, policy IntentPolicyArtifact) ScopeGate {
	if request.ToolAdmissionTarget != "" && request.ToolAdmissionTarget != "knowledge_query" {
		return ScopeGate{Decision: "in_scope", Reason: "explicit_tool_target"}
	}
	if request.HasRequestedScope {
		return ScopeGate{Decision: "in_scope", Reason: "explicit_requested_scope"}
	}
	if normalizedGoal == "" {
		return ScopeGate{Decision: "in_scope", Reason: "scope_undetermined_delegate"}
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("external_institution")); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("general_world")); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := matchOpenDomainPoliticalFact(normalizedGoal, policy); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := matchToolReadModelCandidate(normalizedGoal, policy); signal != "" {
		return ScopeGate{Decision: "in_scope", Reason: "tool_read_model_candidate_signal", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("campus_scope")); signal != "" {
		return ScopeGate{Decision: "in_scope", Reason: "campus_scope_signal", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, policy.Signals("contextual_follow_up")); signal != "" {
		if contextSignal := firstContextSignal(request.Context, policy); contextSignal != "" {
			return ScopeGate{Decision: "in_scope", Reason: "campus_context_signal", MatchedSignal: contextSignal}
		}
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary"}
}

func knowledgeDomains(request Request) []string {
	if request.HasRequestedScope {
		return []string{request.RequestedScope.Corpus + "/" + request.RequestedScope.Collection}
	}
	return []string{"knowledge_query"}
}

func domainCandidatesForToolTarget(target string, request Request) []string {
	switch target {
	case "place_lookup":
		return []string{"place_lookup"}
	case "transport_schedule_lookup":
		return []string{"transport_schedule_lookup"}
	case "campus_notice_change_set_lookup", "campus_notice_discover", "campus_notice_period_summary", "campus_notice_get":
		return []string{target}
	default:
		return knowledgeDomains(request)
	}
}

func taskKindForToolTarget(target string) string {
	switch target {
	case "place_lookup":
		return "place_lookup"
	case "transport_schedule_lookup":
		return "transport_schedule_lookup"
	case "campus_notice_change_set_lookup", "campus_notice_discover", "campus_notice_period_summary", "campus_notice_get":
		return "notice_lookup"
	default:
		return "knowledge_lookup"
	}
}
