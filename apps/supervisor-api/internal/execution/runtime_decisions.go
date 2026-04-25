package execution

import (
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredplanning"
)

func runtimeDecisions(
	effectiveCapability string,
	lane string,
	userGoal string,
	hasRequestedScope bool,
	requestedScope knowledgeScope,
	versionQuery versionQuery,
	context contextProjection,
) (map[string]any, RuntimeDecisionSummary) {
	policyDecision := runtimepolicy.Evaluate(runtimepolicy.Request{
		EffectiveCapability: effectiveCapability,
		UserGoal:            userGoal,
		HasRequestedScope:   hasRequestedScope,
		RequestedScope: runtimepolicy.Scope{
			Corpus:     requestedScope.Corpus,
			Collection: requestedScope.Collection,
		},
		Context: runtimepolicy.Context{
			SessionSlots:      runtimeSessionSlots(context.SessionSlots),
			SelectedNoticeRef: runtimeSelectedNoticeRef(context.SelectedNoticeRef),
			ProfileMemory:     runtimeProfileMemory(context.ProfileMemory),
		},
	})
	summary := RuntimeDecisionSummary{
		ScopeGateDecision:     policyDecision.ScopeGate.Decision,
		PolicyGateDecision:    policyDecision.PolicyGate.Decision,
		ContextPreflightState: policyDecision.ContextPreflight.State,
		RoutingNextAction:     policyDecision.RoutingFrame.SuggestedNextAction,
		PlanningOutcome:       "not_preplanned",
	}
	decisions := map[string]any{
		"effective_capability": effectiveCapability,
		"lane":                 lane,
		"scope_gate":           policyDecision.ScopeGate.Map(),
		"policy_gate":          policyDecision.PolicyGate.Map(),
		"context_preflight":    policyDecision.ContextPreflight.Map(),
		"tool_policy":          policyDecision.ToolPolicy.Map(),
		"routing_frame":        policyDecision.RoutingFrame.Map(),
	}
	handoff := structuredplanning.Plan(structuredplanning.Request{
		EffectiveCapability: effectiveCapability,
		UserGoal:            userGoal,
		VersionQuery: structuredplanning.VersionQuery{
			Mode:               versionQuery.Mode,
			AsOf:               versionQuery.AsOf,
			VersionID:          versionQuery.VersionID,
			CompareToVersionID: versionQuery.CompareToVersionID,
		},
		SelectedNoticeRef: structuredplanning.SelectedNoticeRef{
			NoticeID:     context.SelectedNoticeRef.NoticeID,
			SourceFamily: context.SelectedNoticeRef.SourceFamily,
			Title:        context.SelectedNoticeRef.Title,
		},
	})
	if handoff != nil {
		summary.PlanningOutcome = "preplanned"
		decisions["planning_outcome"] = "preplanned"
		decisions["preplanned_target"] = handoff.Target
		decisions["allowed_tools"] = handoff.AllowedTools
		decisions["specialist_payload"] = map[string]any{
			"kind":    handoff.PayloadKind,
			"payload": handoff.Payload,
		}
		decisions["preplanned_handoff"] = handoff.Map()
	} else {
		decisions["planning_outcome"] = "not_preplanned"
	}
	return decisions, summary
}

func runtimeSessionSlots(slots []sessionSlot) []runtimepolicy.SessionSlot {
	result := make([]runtimepolicy.SessionSlot, 0, len(slots))
	for _, slot := range slots {
		result = append(result, runtimepolicy.SessionSlot{
			Name:  slot.Name,
			Value: slot.Value,
		})
	}
	return result
}

func runtimeSelectedNoticeRef(ref selectedNoticeRef) runtimepolicy.SelectedNoticeRef {
	return runtimepolicy.SelectedNoticeRef{
		NoticeID:     ref.NoticeID,
		SourceFamily: ref.SourceFamily,
		Title:        ref.Title,
	}
}

func runtimeProfileMemory(items []profileMemoryItem) []runtimepolicy.ProfileMemoryItem {
	result := make([]runtimepolicy.ProfileMemoryItem, 0, len(items))
	for _, item := range items {
		result = append(result, runtimepolicy.ProfileMemoryItem{Value: item.Value})
	}
	return result
}
