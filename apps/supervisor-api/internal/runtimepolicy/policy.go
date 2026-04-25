package runtimepolicy

import "strings"

const (
	PolicyVersion     = "runtime-policy-v1"
	ClassifierVersion = "go-runtime-policy-v1"
	IntentSchema      = "intent-schema-1.0.0"
)

const (
	curriculumProgramSlot       = "curriculum_program"
	curriculumProgramFamilySlot = "curriculum_program_family"
	curriculumSemesterSlot      = "curriculum_semester"
)

type Scope struct {
	Corpus     string
	Collection string
}

type SessionSlot struct {
	Name  string
	Value string
}

type SelectedNoticeRef struct {
	NoticeID     string
	SourceFamily string
	Title        string
}

type ProfileMemoryItem struct {
	Key        string
	Value      string
	Visibility string
}

type Context struct {
	SessionSlots      []SessionSlot
	SelectedNoticeRef SelectedNoticeRef
	ProfileMemory     []ProfileMemoryItem
}

type Request struct {
	EffectiveCapability string
	CapabilitySource    string
	UserGoal            string
	HasRequestedScope   bool
	RequestedScope      Scope
	Context             Context
}

type Decision struct {
	ScopeGate        ScopeGate
	PolicyGate       PolicyGate
	ContextPreflight ContextPreflight
	ToolPolicy       ToolPolicy
	RoutingFrame     RoutingFrame
}

type ScopeGate struct {
	Decision      string
	Reason        string
	MatchedSignal string
}

func (g ScopeGate) Map() map[string]any {
	return map[string]any{
		"decision":       g.Decision,
		"reason":         g.Reason,
		"matched_signal": g.MatchedSignal,
	}
}

type PolicyGate struct {
	Decision      string
	Reason        string
	RiskLevel     string
	MatchedSignal string
}

func (g PolicyGate) Map() map[string]any {
	return map[string]any{
		"decision":       g.Decision,
		"reason":         g.Reason,
		"risk_level":     g.RiskLevel,
		"matched_signal": g.MatchedSignal,
	}
}

type ContextPreflight struct {
	State           string
	ReferenceType   string
	ResolvedSlots   map[string]string
	MissingSlots    []string
	AmbiguityReason string
	MatchedSignal   string
}

func (p ContextPreflight) Map() map[string]any {
	resolvedSlots := map[string]string{}
	for key, value := range p.ResolvedSlots {
		resolvedSlots[key] = value
	}
	return map[string]any{
		"state":            p.State,
		"reference_type":   p.ReferenceType,
		"resolved_slots":   resolvedSlots,
		"missing_slots":    append([]string(nil), p.MissingSlots...),
		"ambiguity_reason": p.AmbiguityReason,
		"matched_signal":   p.MatchedSignal,
	}
}

type ToolPolicy struct {
	PolicyVersion string
}

func (p ToolPolicy) Map() map[string]any {
	return map[string]any{
		"policy_version": p.PolicyVersion,
	}
}

type RoutingFrame struct {
	Capability             string
	TaskKind               string
	DomainCandidates       []string
	MissingSlots           []string
	RiskLevel              string
	NeedsClarification     bool
	SuggestedNextAction    string
	PersonalizationMode    string
	ClarificationSubject   string
	ScopeClass             string
	PolicyReason           string
	LaunchState            string
	ScopeReason            string
	MatchedSignal          string
	ClassifierVersion      string
	SchemaVersion          string
	RoutingConfidence      string
	AmbiguitySignal        string
	ContextResolutionState string
	ContextReferenceType   string
	ResolvedSlots          map[string]string
	AmbiguityReason        string
}

func (f RoutingFrame) Map() map[string]any {
	resolvedSlots := map[string]string{}
	for key, value := range f.ResolvedSlots {
		resolvedSlots[key] = value
	}
	return map[string]any{
		"capability":               f.Capability,
		"task_kind":                f.TaskKind,
		"domain_candidates":        append([]string(nil), f.DomainCandidates...),
		"missing_slots":            append([]string(nil), f.MissingSlots...),
		"risk_level":               f.RiskLevel,
		"needs_clarification":      f.NeedsClarification,
		"suggested_next_action":    f.SuggestedNextAction,
		"personalization_mode":     f.PersonalizationMode,
		"clarification_subject":    f.ClarificationSubject,
		"scope_class":              f.ScopeClass,
		"policy_reason":            f.PolicyReason,
		"launch_state":             f.LaunchState,
		"scope_reason":             f.ScopeReason,
		"matched_signal":           f.MatchedSignal,
		"classifier_version":       f.ClassifierVersion,
		"schema_version":           f.SchemaVersion,
		"routing_confidence":       f.RoutingConfidence,
		"ambiguity_signal":         f.AmbiguitySignal,
		"context_resolution_state": f.ContextResolutionState,
		"context_reference_type":   f.ContextReferenceType,
		"resolved_slots":           resolvedSlots,
		"ambiguity_reason":         f.AmbiguityReason,
	}
}

func Evaluate(request Request) Decision {
	policy, err := LoadIntentPolicy("")
	if err != nil {
		return intentPolicyUnavailableDecision(request)
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

	switch request.EffectiveCapability {
	case "place_lookup":
		frame.DomainCandidates = []string{"navigation"}
		frame.ScopeClass = "in_scope"
		frame.ScopeReason = scopeGate.Reason
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

func intentPolicyUnavailableDecision(request Request) Decision {
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

func resolveContextFollowUp(context Context, normalizedGoal string, policy IntentPolicyArtifact) ContextPreflight {
	if signal := firstMatch(normalizedGoal, policy.Signals("contextual_follow_up")); signal != "" {
		candidates := previousGoalContextCandidates(context, policy)
		if len(candidates) == 0 {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "previous_goal",
				MissingSlots:  []string{"previous_goal"},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		if len(candidates) > 1 {
			return ContextPreflight{
				State:           "ambiguous",
				ReferenceType:   "previous_goal",
				MissingSlots:    []string{"previous_goal"},
				ResolvedSlots:   map[string]string{},
				AmbiguityReason: "multiple_previous_goal_candidates",
				MatchedSignal:   signal,
			}
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "previous_goal",
			ResolvedSlots: map[string]string{
				"previous_goal": candidates[0],
			},
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	if signal := firstMatch(normalizedGoal, policy.Signals("notice_context_reference")); signal != "" {
		if context.SelectedNoticeRef.NoticeID == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "selected_notice",
				MissingSlots:  []string{"selected_notice_ref"},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{"notice_id": context.SelectedNoticeRef.NoticeID}
		if context.SelectedNoticeRef.SourceFamily != "" {
			resolvedSlots["notice_source_family"] = context.SelectedNoticeRef.SourceFamily
		}
		if context.SelectedNoticeRef.Title != "" {
			resolvedSlots["notice_title"] = context.SelectedNoticeRef.Title
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "selected_notice",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	if signal := firstMatch(normalizedGoal, policy.Signals("curriculum_semester")); signal != "" &&
		looksLikeContextualSemesterFollowUp(normalizedGoal, policy) {
		program := sessionSlotValue(context.SessionSlots, curriculumProgramSlot)
		programFamily := sessionSlotValue(context.SessionSlots, curriculumProgramFamilySlot)
		if program == "" && programFamily == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "curriculum_slot",
				MissingSlots:  []string{curriculumProgramSlot},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{curriculumSemesterSlot: signal}
		if program != "" {
			resolvedSlots[curriculumProgramSlot] = program
		}
		if programFamily != "" {
			resolvedSlots[curriculumProgramFamilySlot] = programFamily
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "curriculum_slot",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	return ContextPreflight{
		State:         "not_follow_up",
		ReferenceType: "none",
		ResolvedSlots: map[string]string{},
		MissingSlots:  []string{},
	}
}

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
	if signal := firstMatch(normalizedGoal, policy.Signals("structured_transport")); signal != "" {
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

func isPlannableCampusServicesSubtype(normalizedGoal string, policy IntentPolicyArtifact) bool {
	if firstMatch(normalizedGoal, policy.Signals("structured_transport")) != "" {
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
	serviceGuideSubject := firstMatch(normalizedGoal, policy.Signals("structured_service_guide_subject"))
	if serviceGuideSubject == "" {
		return ""
	}
	if !containsAny(normalizedGoal, policy.Signals("structured_service_guide_action")) {
		return ""
	}
	return serviceGuideSubject
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
	for _, item := range context.ProfileMemory {
		if item.Key != "" && item.Key != "recent_goal" {
			continue
		}
		value := strings.TrimSpace(item.Value)
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
		if slot.Name == name {
			return slot.Value
		}
	}
	return ""
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

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
