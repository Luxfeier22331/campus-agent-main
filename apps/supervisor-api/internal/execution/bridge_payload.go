package execution

import (
	"encoding/json"
	"fmt"
	"strings"
)

func BridgePayloadForHandoff(
	basePayload json.RawMessage,
	handoff RuntimeHandoff,
	projections ...StepOutputProjection,
) (json.RawMessage, error) {
	var payload map[string]any
	if err := json.Unmarshal(basePayload, &payload); err != nil {
		return nil, fmt.Errorf("decode bridge payload: %w", err)
	}
	decisions, ok := payload["runtime_decisions"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("runtime_decisions must be an object")
	}
	selectedTool := selectedToolForRuntimeHandoff(handoff)
	userGoal := bridgeUserGoalForHandoff(payload["user_goal"], handoff, firstNoticeProjection(projections))
	payload["user_goal"] = userGoal
	decisions["handoff"] = map[string]any{
		"planning_outcome": "preplanned",
		"target":           handoff.Target,
		"allowed_tools":    append([]string{}, handoff.AllowedTools...),
		"agent_request": map[string]any{
			"target":            handoff.Target,
			"user_goal":         userGoal,
			"conversation_id":   payload["conversation_id"],
			"request_id":        payload["request_id"],
			"safety_identifier": payload["safety_identifier"],
			"trace":             payload["trace"],
			"actor":             payload["actor"],
			"context":           payload["context"],
			"payload": map[string]any{
				"kind":    handoff.PayloadKind,
				"payload": cloneAnyMap(handoff.Payload),
			},
			"allowed_tools": append([]string{}, handoff.AllowedTools...),
		},
	}
	if summary, ok := decisions["runtime_decision_summary"].(map[string]any); ok {
		summary["planning_outcome"] = "preplanned"
		summary["selected_target"] = handoff.Target
		summary["selected_tool"] = selectedTool
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode bridge payload: %w", err)
	}
	return raw, nil
}

func firstNoticeProjection(projections []StepOutputProjection) StepOutputProjection {
	projection, _ := FirstProjectionOfKind(projections, ProjectionKindNoticeContext)
	return projection
}

func bridgeUserGoalForHandoff(
	rawUserGoal any,
	handoff RuntimeHandoff,
	projection StepOutputProjection,
) string {
	userGoal, _ := rawUserGoal.(string)
	if handoff.Target != "rag-agent" || !projection.hasNoticeContext() {
		return userGoal
	}
	parts := []string{strings.TrimSpace(userGoal), "", "已读取的通知上下文："}
	if title := projection.NoticeTitle(); title != "" {
		parts = append(parts, "标题："+title)
	}
	if summary := projection.NoticeBodyExcerpt(); summary != "" {
		parts = append(parts, "摘要："+summary)
	}
	if sourceURL := projection.NoticeSourceURL(); sourceURL != "" {
		parts = append(parts, "原文链接："+sourceURL)
	}
	return strings.Join(parts, "\n")
}

func (projection StepOutputProjection) hasNoticeContext() bool {
	return projection.ProjectionKind == ProjectionKindNoticeContext &&
		(projection.NoticeTitle() != "" ||
			projection.NoticeBodyExcerpt() != "" ||
			projection.NoticeSourceURL() != "")
}

func selectedToolForRuntimeHandoff(handoff RuntimeHandoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Target == "rag-agent" {
		return "retrieval.query"
	}
	return ""
}
