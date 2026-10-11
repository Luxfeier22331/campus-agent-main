package operation

import (
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type WorkflowRuntimeLimits struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxOutputTokens       int
	MaxFunctionToolCalls  int
	MaxTurns              int
	MaxPlanSteps          int
	MaxReplans            int
}

func WorkflowConversationContextForRun(
	payload map[string]any,
	limits WorkflowRuntimeLimits,
) (map[string]any, error) {
	currentInput := strings.TrimSpace(execution.StringValue(payload["user_goal"]))
	currentInputChars := len([]rune(currentInput))
	if currentInputChars > limits.CurrentInputCharLimit {
		return nil, fmt.Errorf(
			"current user input has %d characters, limit is %d",
			currentInputChars,
			limits.CurrentInputCharLimit,
		)
	}
	conversation := execution.CloneAnyMapFromValue(execution.NestedAny(payload, "context", "conversation"))
	if len(conversation) == 0 {
		return nil, nil
	}
	context := map[string]any{
		"schema_version": "agent_conversation_context.v1",
		"recent_turns":   WorkflowNormalizedRecentTurns(conversation),
	}
	if sessionState := WorkflowModelRelevantSessionState(conversation); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	return context, nil
}

func WorkflowNormalizedRecentTurns(conversation map[string]any) []any {
	turns := AnyListFromAny(conversation["recent_turns"])
	result := make([]any, 0, len(turns))
	for _, raw := range turns {
		turn := execution.CloneAnyMapFromValue(raw)
		role := execution.FirstNonEmptyText(turn["role"])
		if role != "user" && role != "assistant" {
			continue
		}
		content := execution.FirstNonEmptyText(turn["content"])
		if content == "" {
			continue
		}
		item := map[string]any{"role": role, "content": content}
		if messageID := execution.FirstNonEmptyText(turn["message_id"]); messageID != "" {
			item["message_id"] = messageID
		}
		result = append(result, item)
	}
	return result
}

func WorkflowModelRelevantSessionState(conversation map[string]any) map[string]any {
	state := execution.CloneAnyMapFromValue(conversation["session_state"])
	confirmedSlots := make([]any, 0)
	for _, rawSlot := range AnyListFromAny(state["confirmed_slots"]) {
		slot := execution.CloneAnyMapFromValue(rawSlot)
		confirmed, _ := slot["confirmed"].(bool)
		name := execution.FirstNonEmptyText(slot["name"])
		value := execution.FirstNonEmptyText(slot["value"])
		if confirmed && name != "" && value != "" {
			confirmedSlots = append(confirmedSlots, map[string]any{
				"confirmed": true,
				"name":      name,
				"value":     value,
			})
		}
	}
	if len(confirmedSlots) == 0 {
		return nil
	}
	return map[string]any{"confirmed_slots": confirmedSlots}
}

func AnyListFromAny(value any) []any {
	values, _ := value.([]any)
	return values
}
