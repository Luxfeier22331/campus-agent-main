package runtimepolicy

func evaluateScope(request Request, normalizedGoal string, policy IntentPolicyArtifact) ScopeGate {
	if request.EffectiveCapability != "" && request.EffectiveCapability != "knowledge" {
		reason := "explicit_requested_capability"
		if request.CapabilitySource == "inferred" {
			reason = "structured_runtime_candidate_signal"
		}
		return ScopeGate{Decision: "in_scope", Reason: reason}
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
	if signal := matchStructuredRuntimeCandidate(normalizedGoal, policy); signal != "" {
		return ScopeGate{Decision: "in_scope", Reason: "structured_runtime_candidate_signal", MatchedSignal: signal}
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
	return []string{"knowledge"}
}

func domainCandidatesForCapability(capability string, request Request) []string {
	switch capability {
	case "place_lookup":
		return []string{"navigation"}
	case "campus_services":
		return []string{"campus_services"}
	case "notice":
		return []string{"notice"}
	default:
		return knowledgeDomains(request)
	}
}

func taskKindForCapability(capability string) string {
	switch capability {
	case "place_lookup":
		return "place_lookup"
	case "campus_services":
		return "campus_services_lookup"
	case "notice":
		return "notice_lookup"
	default:
		return "knowledge_lookup"
	}
}
