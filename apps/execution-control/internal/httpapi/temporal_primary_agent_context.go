package httpapi

import (
	"encoding/json"
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

type primaryAgentContextPolicyStats struct {
	DroppedCategoryCounts   map[string]any
	ModelVisibleAfterCount  int
	ModelVisibleBeforeCount int
	ContextCharsAfter       int
	ContextCharsBefore      int
	CurrentInputChars       int
	GroundingContextChars   int
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

func primaryAgentFinalModelContextForRun(
	payload map[string]any,
	limits primaryAgentRuntimeLimits,
	grounding groundingContext,
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
	availableContextChars := limits.ContextCharLimit - currentInputChars - grounding.ModelContextChars
	if availableContextChars < 0 {
		return nil, fmt.Errorf(
			"current input and grounding use %d characters, limit is %d",
			currentInputChars+grounding.ModelContextChars,
			limits.ContextCharLimit,
		)
	}
	conversation := cloneAnyMapFromMetadata(nestedAny(payload, "context", "conversation"))
	if len(conversation) == 0 {
		return nil, nil
	}
	context := map[string]any{
		"schema_version": "final_model_context.v3",
		"recent_turns":   primaryAgentNormalizedRecentTurns(conversation),
	}
	if sessionState := primaryAgentModelRelevantSessionState(conversation); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	beforeContext := cloneAnyMapFromMetadata(context)
	contextCharsBefore, err := primaryAgentContextCharacterCount(beforeContext)
	if err != nil {
		return nil, err
	}
	droppedCategoryCounts, contextCharsAfter, err := primaryAgentApplyContextBudget(
		context,
		availableContextChars,
	)
	if err != nil {
		return nil, err
	}
	stats := primaryAgentContextPolicyStats{
		DroppedCategoryCounts:   droppedCategoryCounts,
		ModelVisibleAfterCount:  primaryAgentModelVisibleItemCount(context),
		ModelVisibleBeforeCount: primaryAgentModelVisibleItemCount(beforeContext),
		ContextCharsAfter:       contextCharsAfter + currentInputChars + grounding.ModelContextChars,
		ContextCharsBefore:      contextCharsBefore + currentInputChars + grounding.ModelContextChars,
		CurrentInputChars:       currentInputChars,
		GroundingContextChars:   grounding.ModelContextChars,
	}
	context["usage_summary"] = primaryAgentFinalModelUsageSummary(stats)
	return context, nil
}

func primaryAgentFinalModelUsageSummary(stats primaryAgentContextPolicyStats) map[string]any {
	usage := map[string]any{
		"context_chars":            stats.ContextCharsAfter,
		"current_input_chars":      stats.CurrentInputChars,
		"grounding_context_chars":  stats.GroundingContextChars,
		"model_visible_item_count": stats.ModelVisibleAfterCount,
		"runtime_only_item_count":  0,
	}
	if len(stats.DroppedCategoryCounts) > 0 {
		usage["truncation_reason"] = "context_policy_limit"
		usage["truncation_summary"] = primaryAgentTruncationSummary(stats)
	}
	return usage
}

func primaryAgentTruncationSummary(stats primaryAgentContextPolicyStats) map[string]any {
	return map[string]any{
		"schema_version":             "truncation_summary.v2",
		"policy_version":             "primary_agent_context.v4",
		"reason":                     "context_policy_limit",
		"context_chars_before":       stats.ContextCharsBefore,
		"context_chars_after":        stats.ContextCharsAfter,
		"model_visible_before_count": stats.ModelVisibleBeforeCount,
		"model_visible_after_count":  stats.ModelVisibleAfterCount,
		"runtime_only_before_count":  0,
		"runtime_only_after_count":   0,
		"dropped_category_counts":    stats.DroppedCategoryCounts,
	}
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
		item := map[string]any{"role": role}
		if messageID := firstNonEmptyText(turn["message_id"]); messageID != "" {
			item["message_id"] = messageID
		}
		content := firstNonEmptyText(turn["content"])
		if content == "" {
			continue
		}
		item["content"] = content
		result = append(result, item)
	}
	return result
}

func primaryAgentModelRelevantSessionState(conversation map[string]any) map[string]any {
	state := cloneAnyMapFromMetadata(conversation["session_state"])
	for _, rawSlot := range anyListFromAny(state["confirmed_slots"]) {
		slot := cloneAnyMapFromMetadata(rawSlot)
		confirmed, _ := slot["confirmed"].(bool)
		if confirmed && firstNonEmptyText(slot["value"]) != "" {
			return state
		}
	}
	selectedNotice := cloneAnyMapFromMetadata(state["selected_notice_ref"])
	if firstNonEmptyText(selectedNotice["notice_id"]) != "" {
		return state
	}
	return nil
}

func primaryAgentModelVisibleItemCount(context map[string]any) int {
	count := 0
	count += len(anyListFromAny(context["recent_turns"]))
	if len(cloneAnyMapFromMetadata(context["session_state"])) > 0 {
		count++
	}
	return count
}

func primaryAgentApplyContextBudget(context map[string]any, limit int) (map[string]any, int, error) {
	dropped := map[string]any{}
	for {
		count, err := primaryAgentContextCharacterCount(context)
		if err != nil {
			return nil, 0, err
		}
		if count <= limit {
			return dropped, count, nil
		}
		if droppedTurns := primaryAgentDropOldestRecentSegment(context, true); droppedTurns > 0 {
			incrementAnyCount(dropped, "recent_turns", droppedTurns)
			continue
		}
		if droppedTurns := primaryAgentDropOldestRecentSegment(context, false); droppedTurns > 0 {
			incrementAnyCount(dropped, "recent_turns", droppedTurns)
			continue
		}
		return nil, count, fmt.Errorf(
			"final model context has %d characters after deterministic truncation, limit is %d",
			count,
			limit,
		)
	}
}

func primaryAgentContextCharacterCount(context map[string]any) (int, error) {
	payload := cloneAnyMapFromMetadata(context)
	delete(payload, "usage_summary")
	encoded, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("encode final model context for character budget: %w", err)
	}
	return len([]rune(string(encoded))), nil
}

func primaryAgentDropOldestRecentSegment(context map[string]any, preserveLatest bool) int {
	turns := anyListFromAny(context["recent_turns"])
	if len(turns) == 0 {
		return 0
	}
	dropCount := 1
	for dropCount < len(turns) {
		turn := cloneAnyMapFromMetadata(turns[dropCount])
		if firstNonEmptyText(turn["role"]) == "user" {
			break
		}
		dropCount++
	}
	if preserveLatest && dropCount == len(turns) {
		return 0
	}
	context["recent_turns"] = append([]any{}, turns[dropCount:]...)
	return dropCount
}

func incrementAnyCount(counts map[string]any, key string, delta int) {
	counts[key] = intFromAny(counts[key]) + delta
}

func primaryAgentContextUsageSummary(finalModelContext map[string]any) map[string]any {
	if len(finalModelContext) == 0 {
		return nil
	}
	usage := cloneAnyMapFromMetadata(finalModelContext["usage_summary"])
	summary := map[string]any{
		"schema_version":           finalModelContext["schema_version"],
		"recent_turn_count":        len(anyListFromAny(finalModelContext["recent_turns"])),
		"model_visible_item_count": usage["model_visible_item_count"],
		"runtime_only_item_count":  usage["runtime_only_item_count"],
		"context_chars":            usage["context_chars"],
		"current_input_chars":      usage["current_input_chars"],
		"grounding_context_chars":  usage["grounding_context_chars"],
	}
	if reason := firstNonEmptyText(usage["truncation_reason"]); reason != "" {
		summary["truncation_reason"] = reason
	}
	if truncationSummary := cloneAnyMapFromMetadata(usage["truncation_summary"]); len(truncationSummary) > 0 {
		summary["truncation_summary"] = truncationSummary
	}
	return summary
}

func withPrimaryAgentContextUsage(payload map[string]any, finalModelContext map[string]any) map[string]any {
	if summary := primaryAgentContextUsageSummary(finalModelContext); summary != nil {
		payload["context_usage"] = summary
	}
	return payload
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

func copyOptionalString(target map[string]any, source map[string]any, key string) {
	if value := firstNonEmptyText(source[key]); value != "" {
		target[key] = value
	}
}

type agentRuntimeResponse struct {
	Status                 string            `json:"status"`
	Error                  agentRuntimeError `json:"error"`
	RunID                  string            `json:"run_id"`
	FinalOutput            string            `json:"final_output"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace"`
	ProviderResponseID     string            `json:"provider_response_id"`
	StageTiming            map[string]any    `json:"stage_timing"`
	ToolResults            []agentToolResult `json:"tool_results"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope"`
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
