package runtimepolicy

func Evaluate(request Request) Decision {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		return IntentPolicyUnavailableDecision(request)
	}
	return EvaluateWithPolicy(request, policy)
}

func EvaluateWithPolicy(request Request, policy IntentPolicyArtifact) Decision {
	normalizedGoal := NormalizeGoal(request.UserGoal)
	contextPreflight := resolveContextFollowUp(request.Context, normalizedGoal, policy)
	scopeGate := evaluateScope(request, normalizedGoal, policy)
	policyGate := PolicyGate{Decision: "delegate", RiskLevel: "low"}

	frame := baseRoutingFrame(request.EffectiveCapability, policy)
	frame.ContextResolutionState = contextPreflight.State
	frame.ContextReferenceType = contextPreflight.ReferenceType
	frame.ResolvedSlots = contextPreflight.ResolvedSlots
	frame.AmbiguityReason = contextPreflight.AmbiguityReason

	if reason := evaluatePolicyReason(normalizedGoal, policy); reason != "" {
		policyGate = PolicyGate{
			Decision:  "rejected",
			Reason:    reason,
			RiskLevel: "high",
		}
		frame.DomainCandidates = []string{"policy_refusal"}
		frame.RiskLevel = "high"
		frame.SuggestedNextAction = "rejected"
		frame.ScopeClass = "in_scope"
		frame.PolicyReason = reason
		frame.LaunchState = "closed"
		frame.ScopeReason = "policy_guardrail"
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{policy.PolicyVersion}, frame}
	}

	if isHighRiskTransactionAction(normalizedGoal, policy) {
		policyGate = PolicyGate{
			Decision:  "approval_required",
			Reason:    "approval_required",
			RiskLevel: "high",
		}
		frame.DomainCandidates = domainCandidatesForCapability(request.EffectiveCapability, request)
		frame.RiskLevel = "high"
		frame.SuggestedNextAction = "approval_required"
		frame.ScopeClass = "in_scope"
		frame.PolicyReason = "approval_required"
		frame.LaunchState = "closed"
		frame.ScopeReason = "transaction_guardrail"
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{policy.PolicyVersion}, frame}
	}

	if contextPreflight.State == "missing_context" || contextPreflight.State == "ambiguous" {
		reason := "context_missing"
		if contextPreflight.State == "ambiguous" {
			reason = "context_ambiguous"
		}
		frame.DomainCandidates = []string{"context_follow_up"}
		frame.MissingSlots = append([]string(nil), contextPreflight.MissingSlots...)
		frame.NeedsClarification = true
		frame.SuggestedNextAction = "clarify"
		frame.ScopeClass = "in_scope"
		frame.LaunchState = "candidate_only"
		frame.ScopeReason = reason
		frame.MatchedSignal = contextPreflight.MatchedSignal
		frame.RoutingConfidence = "low"
		if contextPreflight.State == "ambiguous" {
			frame.AmbiguitySignal = contextPreflight.MatchedSignal
		}
		policyGate = PolicyGate{
			Decision:      "clarify",
			Reason:        reason,
			RiskLevel:     "low",
			MatchedSignal: contextPreflight.MatchedSignal,
		}
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{policy.PolicyVersion}, frame}
	}

	if ineligibleReason := selectedNoticeKnowledgeFollowthroughIneligibleReason(
		request,
		normalizedGoal,
		policy,
	); ineligibleReason != "" {
		frame.DomainCandidates = []string{"selected_notice_followthrough"}
		frame.SuggestedNextAction = "out_of_scope"
		frame.ScopeClass = "in_scope"
		frame.PolicyReason = ineligibleReason
		frame.LaunchState = "closed"
		frame.ScopeReason = ineligibleReason
		frame.MatchedSignal = contextPreflight.MatchedSignal
		policyGate = PolicyGate{
			Decision:      "out_of_scope",
			Reason:        ineligibleReason,
			RiskLevel:     "low",
			MatchedSignal: contextPreflight.MatchedSignal,
		}
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{policy.PolicyVersion}, frame}
	}

	switch request.EffectiveCapability {
	case "place_lookup":
		frame.DomainCandidates = []string{"out_of_scope"}
		frame.SuggestedNextAction = "out_of_scope"
		frame.ScopeClass = "out_of_scope"
		frame.PolicyReason = "navigation_temporarily_unsupported"
		frame.LaunchState = "closed"
		frame.ScopeReason = "navigation_temporarily_unsupported"
		policyGate = PolicyGate{
			Decision:  "out_of_scope",
			Reason:    frame.PolicyReason,
			RiskLevel: "low",
		}
	case "campus_services":
		if !isPlannableCampusServicesSubtype(normalizedGoal, policy) {
			frame.DomainCandidates = []string{"campus_services"}
			frame.MissingSlots = []string{"campus_service_task"}
			frame.NeedsClarification = true
			frame.SuggestedNextAction = "clarify"
			frame.ScopeClass = "in_scope"
			frame.LaunchState = "candidate_only"
			frame.ScopeReason = "structured_subtype_missing"
			frame.RoutingConfidence = "low"
			policyGate = PolicyGate{
				Decision:  "clarify",
				Reason:    "structured_subtype_missing",
				RiskLevel: "low",
			}
		} else {
			frame.DomainCandidates = []string{"campus_services"}
			frame.ScopeClass = "in_scope"
			frame.ScopeReason = scopeGate.Reason
		}
	case "notice":
		frame.DomainCandidates = []string{"notice"}
		frame.ScopeClass = "in_scope"
		frame.ScopeReason = scopeGate.Reason
	default:
		if scopeGate.Decision == "out_of_scope" {
			frame.DomainCandidates = []string{"out_of_scope"}
			frame.SuggestedNextAction = "out_of_scope"
			frame.ScopeClass = "out_of_scope"
			frame.PolicyReason = scopeGate.Reason
			frame.LaunchState = "closed"
			frame.ScopeReason = scopeGate.Reason
			frame.MatchedSignal = scopeGate.MatchedSignal
			policyGate = PolicyGate{
				Decision:      "out_of_scope",
				Reason:        scopeGate.Reason,
				RiskLevel:     "low",
				MatchedSignal: scopeGate.MatchedSignal,
			}
		} else {
			frame.DomainCandidates = knowledgeDomains(request)
			frame.ScopeClass = "in_scope"
			frame.ScopeReason = scopeGate.Reason
			frame.MatchedSignal = scopeGate.MatchedSignal
			if scopeGate.Reason == "structured_runtime_candidate_signal" {
				frame.LaunchState = "candidate_only"
			}
		}
	}

	return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{policy.PolicyVersion}, frame}
}

func selectedNoticeKnowledgeFollowthroughIneligibleReason(
	request Request,
	normalizedGoal string,
	policy IntentPolicyArtifact,
) string {
	if request.Context.SelectedNoticeRef.NoticeID == "" {
		return ""
	}
	if request.Context.SelectedNoticeRef.TargetSurface == "" {
		return ""
	}
	if !request.HasRequestedScope ||
		request.RequestedScope.Corpus != "regulations" ||
		!containsAny(normalizedGoal, policy.Signals("notice_knowledge_followthrough")) {
		return ""
	}
	switch request.Context.SelectedNoticeRef.TargetSurface {
	case "regulations/student_rules", "regulations/institutional_rules", "regulations/scoped_rules":
		return ""
	default:
		return "selected_notice_target_surface_ineligible_for_knowledge_followthrough"
	}
}

func IntentPolicyUnavailableDecision(request Request) Decision {
	contextPreflight := ContextPreflight{
		State:         "not_follow_up",
		ReferenceType: "none",
		ResolvedSlots: map[string]string{},
		MissingSlots:  []string{},
	}
	scopeGate := ScopeGate{Decision: "out_of_scope", Reason: "intent_policy_unavailable"}
	policyGate := PolicyGate{Decision: "rejected", Reason: "intent_policy_unavailable", RiskLevel: "high"}
	frame := RoutingFrame{
		Capability:             defaultString(request.EffectiveCapability, "knowledge"),
		TaskKind:               taskKindForCapability(request.EffectiveCapability),
		DomainCandidates:       []string{"policy_refusal"},
		MissingSlots:           []string{},
		RiskLevel:              "high",
		NeedsClarification:     false,
		SuggestedNextAction:    "rejected",
		PersonalizationMode:    "generic",
		ClarificationSubject:   "",
		ScopeClass:             "out_of_scope",
		PolicyReason:           "intent_policy_unavailable",
		LaunchState:            "closed",
		ScopeReason:            "intent_policy_unavailable",
		MatchedSignal:          "",
		ClassifierVersion:      ClassifierVersion,
		SchemaVersion:          IntentSchema,
		RoutingConfidence:      "low",
		AmbiguitySignal:        "",
		ContextResolutionState: "not_follow_up",
		ContextReferenceType:   "none",
		ResolvedSlots:          map[string]string{},
		AmbiguityReason:        "",
	}
	return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{PolicyVersion}, frame}
}

func baseRoutingFrame(capability string, policy IntentPolicyArtifact) RoutingFrame {
	return RoutingFrame{
		Capability:             defaultString(capability, "knowledge"),
		TaskKind:               taskKindForCapability(capability),
		DomainCandidates:       []string{"knowledge"},
		MissingSlots:           []string{},
		RiskLevel:              "low",
		NeedsClarification:     false,
		SuggestedNextAction:    "delegate",
		PersonalizationMode:    "generic",
		ClarificationSubject:   "",
		ScopeClass:             "in_scope",
		PolicyReason:           "",
		LaunchState:            "open",
		ScopeReason:            "scope_undetermined_delegate",
		MatchedSignal:          "",
		ClassifierVersion:      policy.ClassifierVersion,
		SchemaVersion:          policy.IntentSchemaVersion,
		RoutingConfidence:      "high",
		AmbiguitySignal:        "",
		ContextResolutionState: "not_follow_up",
		ContextReferenceType:   "none",
		ResolvedSlots:          map[string]string{},
		AmbiguityReason:        "",
	}
}
