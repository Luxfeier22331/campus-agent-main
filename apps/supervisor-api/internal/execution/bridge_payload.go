package execution

import (
	"encoding/json"
	"fmt"
)

func BridgePayloadForHandoff(
	basePayload json.RawMessage,
	handoff RuntimeHandoff,
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
	decisions["handoff"] = map[string]any{
		"planning_outcome": "preplanned",
		"target":           handoff.Target,
		"allowed_tools":    append([]string{}, handoff.AllowedTools...),
		"agent_request": map[string]any{
			"target":            handoff.Target,
			"user_goal":         payload["user_goal"],
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

func selectedToolForRuntimeHandoff(handoff RuntimeHandoff) string {
	if len(handoff.AllowedTools) == 1 {
		return handoff.AllowedTools[0]
	}
	if handoff.Target == "rag-agent" {
		return "retrieval.query"
	}
	return ""
}
