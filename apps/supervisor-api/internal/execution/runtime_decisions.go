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
) (map[string]any, RuntimeDecisionSummary, *RuntimeHandoff) {
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
		HasRequestedScope:   hasRequestedScope,
		RequestedScope: structuredplanning.Scope{
			Corpus:     requestedScope.Corpus,
			Collection: requestedScope.Collection,
		},
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
	if policyDecision.RoutingFrame.SuggestedNextAction == "delegate" && handoff != nil {
		summary.PlanningOutcome = "preplanned"
		summary.SelectedTarget = handoff.Target
		if len(handoff.AllowedTools) == 1 {
			summary.SelectedTool = handoff.AllowedTools[0]
		}
		runtimeHandoff := &RuntimeHandoff{
			Target:       handoff.Target,
			PayloadKind:  handoff.PayloadKind,
			Payload:      handoff.Payload,
			AllowedTools: append([]string(nil), handoff.AllowedTools...),
		}
		decisions["handoff"] = map[string]any{
			"planning_outcome": "preplanned",
			"target":           handoff.Target,
			"allowed_tools":    handoff.AllowedTools,
			"specialist_payload": map[string]any{
				"kind":    handoff.PayloadKind,
				"payload": handoff.Payload,
			},
		}
		decisions["runtime_decision_summary"] = summary.Map()
		return decisions, summary, runtimeHandoff
	}
	if policyDecision.RoutingFrame.SuggestedNextAction != "delegate" {
		terminal := terminalEnvelope(policyDecision.RoutingFrame)
		if terminal != nil {
			summary.TerminalOutcome, _ = terminal["status"].(string)
			summary.FailCloseReason = failCloseReason(policyDecision.RoutingFrame)
			decisions["terminal_envelope"] = terminal
		}
	}
	decisions["runtime_decision_summary"] = summary.Map()
	return decisions, summary, nil
}

func terminalEnvelope(frame runtimepolicy.RoutingFrame) map[string]any {
	switch frame.SuggestedNextAction {
	case "clarify":
		return map[string]any{
			"selected_target":    nil,
			"status":             "needs_clarification",
			"answer_text":        "",
			"follow_up_question": clarificationQuestion(frame),
			"confidence":         "low",
			"observability":      terminalObservability(frame, "needs_clarification", false),
		}
	case "approval_required":
		return map[string]any{
			"selected_target":    nil,
			"status":             "approval_required",
			"answer_text":        "该请求涉及需要人工确认的操作，必须先经过审批。",
			"follow_up_question": "",
			"confidence":         "low",
			"observability":      terminalObservability(frame, "approval_required", true),
		}
	case "out_of_scope":
		return map[string]any{
			"selected_target":    nil,
			"status":             "no_answer",
			"answer_text":        outOfScopeAnswerText(frame.PolicyReason),
			"follow_up_question": "",
			"confidence":         "low",
			"observability":      terminalObservability(frame, "out_of_scope", true),
		}
	case "rejected":
		return map[string]any{
			"selected_target":    nil,
			"status":             "rejected",
			"answer_text":        "这个请求不在当前可执行范围内。",
			"follow_up_question": "",
			"confidence":         "low",
			"error": map[string]any{
				"code":    "request_rejected",
				"message": "request was rejected by supervisor policy",
			},
			"observability": terminalObservability(frame, "policy_refusal", true),
		}
	default:
		return nil
	}
}

func terminalObservability(
	frame runtimepolicy.RoutingFrame,
	semanticOutcome string,
	failClosed bool,
) map[string]any {
	aclDecision := "allowed"
	if frame.SuggestedNextAction == "approval_required" {
		aclDecision = "approval_required"
	}
	if frame.SuggestedNextAction == "rejected" {
		aclDecision = "denied"
	}
	return map[string]any{
		"retrieval_attempted":    false,
		"candidate_count":        0,
		"retrieved_source_count": 0,
		"citation_expected":      false,
		"citation_count":         0,
		"citation_missing":       false,
		"refusal_class":          refusalClass(frame),
		"semantic_outcome":       semanticOutcome,
		"scope_class":            frame.ScopeClass,
		"policy_reason":          defaultRuntimeString(frame.PolicyReason, frame.ScopeReason),
		"acl_decision":           aclDecision,
		"fail_closed":            failClosed,
	}
}

func clarificationQuestion(frame runtimepolicy.RoutingFrame) string {
	for _, slot := range frame.MissingSlots {
		if slot == "requested_scope" {
			if frame.ClarificationSubject != "" {
				return "按当前对话上下文理解，你现在想继续问" + frame.ClarificationSubject + "相关事项；请先说明你想查询的知识范围或资料集合。"
			}
			return "请先说明你想查询的知识范围或资料集合。"
		}
	}
	return "请补充完成当前请求所需的关键信息。"
}

func outOfScopeAnswerText(policyReason string) string {
	if policyReason == "navigation_temporarily_unsupported" {
		return "当前暂不支持校内导航或地点查询，待地图能力正式上线后再开放。"
	}
	return "当前仅支持中央民族大学校园范围内且已开放能力面的问答，这个问题不在当前支持范围内。"
}

func refusalClass(frame runtimepolicy.RoutingFrame) string {
	switch frame.SuggestedNextAction {
	case "clarify":
		return "needs_clarification"
	case "approval_required":
		return "approval_required"
	case "out_of_scope":
		return "out_of_scope"
	case "rejected":
		return "rejected"
	default:
		return ""
	}
}

func failCloseReason(frame runtimepolicy.RoutingFrame) string {
	if frame.PolicyReason != "" {
		return frame.PolicyReason
	}
	return frame.ScopeReason
}

func defaultRuntimeString(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
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
		result = append(result, runtimepolicy.ProfileMemoryItem{
			Key:        item.Key,
			Value:      item.Value,
			Visibility: item.Visibility,
		})
	}
	return result
}
