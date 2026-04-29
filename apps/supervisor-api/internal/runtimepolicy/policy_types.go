package runtimepolicy

const (
	PolicyVersion     = "runtime-policy-v1"
	ClassifierVersion = "go-runtime-policy-v2"
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
	Name      string
	Value     string
	Confirmed bool
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

type CapabilityResolutionRequest struct {
	RequestedCapability string
	UserGoal            string
	HasRequestedScope   bool
	VersionQueryMode    string
}

type CapabilityResolution struct {
	EffectiveCapability string
	Source              string
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
