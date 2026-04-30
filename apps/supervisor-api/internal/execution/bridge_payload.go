package execution

import (
	"encoding/json"
	"fmt"
	"strings"
)

const maxBridgeNoticeContextBodyLength = 1600

type BridgePayloadContext struct {
	NoticeTitle     string
	NoticeBody      string
	NoticeSourceURL string
}

func BridgePayloadForHandoff(
	basePayload json.RawMessage,
	handoff RuntimeHandoff,
	contexts ...BridgePayloadContext,
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
	userGoal := bridgeUserGoalForHandoff(payload["user_goal"], handoff, firstBridgePayloadContext(contexts))
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

func firstBridgePayloadContext(contexts []BridgePayloadContext) BridgePayloadContext {
	if len(contexts) == 0 {
		return BridgePayloadContext{}
	}
	return contexts[0]
}

func bridgeUserGoalForHandoff(
	rawUserGoal any,
	handoff RuntimeHandoff,
	context BridgePayloadContext,
) string {
	userGoal, _ := rawUserGoal.(string)
	if handoff.Target != "rag-agent" || !context.hasNoticeContext() {
		return userGoal
	}
	parts := []string{strings.TrimSpace(userGoal), "", "已读取的通知上下文："}
	if title := strings.TrimSpace(context.NoticeTitle); title != "" {
		parts = append(parts, "标题："+title)
	}
	if body := trimNoticeContextBody(context.NoticeBody); body != "" {
		parts = append(parts, "正文："+body)
	}
	if sourceURL := strings.TrimSpace(context.NoticeSourceURL); sourceURL != "" {
		parts = append(parts, "原文链接："+sourceURL)
	}
	return strings.Join(parts, "\n")
}

func (context BridgePayloadContext) hasNoticeContext() bool {
	return strings.TrimSpace(context.NoticeTitle) != "" ||
		strings.TrimSpace(context.NoticeBody) != "" ||
		strings.TrimSpace(context.NoticeSourceURL) != ""
}

func trimNoticeContextBody(value string) string {
	normalized := strings.TrimSpace(value)
	if len([]rune(normalized)) <= maxBridgeNoticeContextBodyLength {
		return normalized
	}
	runes := []rune(normalized)
	return string(runes[:maxBridgeNoticeContextBodyLength]) + "..."
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
