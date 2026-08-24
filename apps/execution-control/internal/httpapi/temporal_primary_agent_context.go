package httpapi

import (
	"fmt"
	"net/http"
	"strings"
)

const primaryAgentTransportGraceMS = 5000

const (
	defaultAgentDeadlineMS        = 90000
	defaultAgentMaxOutputTokens   = 2048
	defaultAgentCurrentInputChars = 8000
	defaultAgentContextChars      = 16000
)

type primaryAgentRuntimeLimits struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxOutputTokens       int
	MaxToolCalls          int
	MaxTurns              int
}

func (s *Server) primaryAgentRuntimeLimits() primaryAgentRuntimeLimits {
	return primaryAgentRuntimeLimits{
		AgentDeadlineMS:       positiveOrDefault(s.config.AgentRuntimeDeadlineMS, defaultAgentDeadlineMS),
		ContextCharLimit:      positiveOrDefault(s.config.AgentRuntimeContextCharLimit, defaultAgentContextChars),
		CurrentInputCharLimit: positiveOrDefault(s.config.AgentRuntimeInputCharLimit, defaultAgentCurrentInputChars),
		MaxOutputTokens:       positiveOrDefault(s.config.AgentRuntimeMaxOutputTokens, defaultAgentMaxOutputTokens),
	}
}

func primaryAgentRuntimeLimitsPayload(limits primaryAgentRuntimeLimits) map[string]any {
	return map[string]any{
		"agent_deadline_ms":        limits.AgentDeadlineMS,
		"context_char_limit":       limits.ContextCharLimit,
		"current_input_char_limit": limits.CurrentInputCharLimit,
		"max_output_tokens":        limits.MaxOutputTokens,
		"max_tool_calls":           limits.MaxToolCalls,
		"max_turns":                limits.MaxTurns,
	}
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func primaryAgentConversationContextForRun(
	payload map[string]any,
	limits primaryAgentRuntimeLimits,
) (map[string]any, error) {
	currentInput := strings.TrimSpace(stringValue(payload["user_goal"]))
	currentInputChars := len([]rune(currentInput))
	if currentInputChars > limits.CurrentInputCharLimit {
		return nil, fmt.Errorf(
			"current user input has %d characters, limit is %d",
			currentInputChars,
			limits.CurrentInputCharLimit,
		)
	}
	conversation := cloneAnyMapFromMetadata(nestedAny(payload, "context", "conversation"))
	if len(conversation) == 0 {
		return nil, nil
	}
	context := map[string]any{
		"schema_version": "agent_conversation_context.v1",
		"recent_turns":   primaryAgentNormalizedRecentTurns(conversation),
	}
	if sessionState := primaryAgentModelRelevantSessionState(conversation); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	return context, nil
}

func primaryAgentNormalizedRecentTurns(conversation map[string]any) []any {
	turns := anyListFromAny(conversation["recent_turns"])
	result := make([]any, 0, len(turns))
	for _, raw := range turns {
		turn := cloneAnyMapFromMetadata(raw)
		role := firstNonEmptyText(turn["role"])
		if role != "user" && role != "assistant" {
			continue
		}
		content := firstNonEmptyText(turn["content"])
		if content == "" {
			continue
		}
		item := map[string]any{"role": role, "content": content}
		if messageID := firstNonEmptyText(turn["message_id"]); messageID != "" {
			item["message_id"] = messageID
		}
		result = append(result, item)
	}
	return result
}

func primaryAgentModelRelevantSessionState(conversation map[string]any) map[string]any {
	state := cloneAnyMapFromMetadata(conversation["session_state"])
	confirmedSlots := make([]any, 0)
	for _, rawSlot := range anyListFromAny(state["confirmed_slots"]) {
		slot := cloneAnyMapFromMetadata(rawSlot)
		confirmed, _ := slot["confirmed"].(bool)
		name := firstNonEmptyText(slot["name"])
		value := firstNonEmptyText(slot["value"])
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

func anyListFromAny(value any) []any {
	values, _ := value.([]any)
	return values
}

func intFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

type agentRuntimeResponse struct {
	Status                 string            `json:"status"`
	Error                  agentRuntimeError `json:"error"`
	RunID                  string            `json:"run_id"`
	ContextUsage           map[string]any    `json:"context_usage"`
	FinalOutput            string            `json:"final_output"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace"`
	ProviderResponseID     string            `json:"provider_response_id"`
	StageTiming            map[string]any    `json:"stage_timing"`
	ToolResults            []agentToolResult `json:"tool_results"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint"`
	Usage                  agentRuntimeUsage `json:"usage"`
}

type agentToolResult struct {
	ArgumentsJSON   map[string]any `json:"arguments_json"`
	DurationMS      float64        `json:"duration_ms"`
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
	PayloadKind     string         `json:"payload_kind"`
	Result          map[string]any `json:"result"`
	ResultRef       string         `json:"result_ref"`
	FailCloseReason string         `json:"fail_close_reason"`
}

type agentRuntimeUsage struct {
	ModelRequestCount int64 `json:"model_request_count"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type agentRuntimeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type agentRuntimeHTTPError struct {
	StatusCode int
	Code       string
}

func (err agentRuntimeHTTPError) Error() string {
	switch strings.TrimSpace(err.Code) {
	case "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "agent_deadline_exceeded", "context_budget_exceeded", "max_turns_exceeded":
		return "The agent runtime could not complete the request."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	default:
		if err.StatusCode >= http.StatusInternalServerError {
			return fmt.Sprintf("agent runtime returned HTTP %d", err.StatusCode)
		}
		return "The agent runtime request was rejected."
	}
}
