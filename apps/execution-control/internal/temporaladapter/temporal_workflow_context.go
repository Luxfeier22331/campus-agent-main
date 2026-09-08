package temporaladapter

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const workflowTransportGraceMS = 5000

const (
	defaultAgentDeadlineMS        = 240000
	defaultAgentMaxOutputTokens   = 2048
	defaultAgentCurrentInputChars = 8000
	defaultAgentContextChars      = 16000
)

type workflowRuntimeLimits struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxOutputTokens       int
	MaxFunctionToolCalls  int
	MaxTurns              int
	MaxPlanSteps          int
	MaxReplans            int
}

func workflowRuntimeLimitsPayload(limits workflowRuntimeLimits) map[string]any {
	return map[string]any{
		"agent_deadline_ms":        limits.AgentDeadlineMS,
		"context_char_limit":       limits.ContextCharLimit,
		"current_input_char_limit": limits.CurrentInputCharLimit,
		"max_output_tokens":        limits.MaxOutputTokens,
		"max_function_tool_calls":  limits.MaxFunctionToolCalls,
		"max_turns":                limits.MaxTurns,
		"max_plan_steps":           limits.MaxPlanSteps,
		"max_replans":              limits.MaxReplans,
	}
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func workflowConversationContextForRun(
	payload map[string]any,
	limits workflowRuntimeLimits,
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
		"recent_turns":   workflowNormalizedRecentTurns(conversation),
	}
	if sessionState := workflowModelRelevantSessionState(conversation); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	return context, nil
}

func workflowNormalizedRecentTurns(conversation map[string]any) []any {
	turns := anyListFromAny(conversation["recent_turns"])
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

func workflowModelRelevantSessionState(conversation map[string]any) map[string]any {
	state := execution.CloneAnyMapFromValue(conversation["session_state"])
	confirmedSlots := make([]any, 0)
	for _, rawSlot := range anyListFromAny(state["confirmed_slots"]) {
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
	Operation               string                    `json:"operation"`
	SolveOutcome            string                    `json:"solve_outcome"`
	Status                  string                    `json:"status"`
	Error                   agentRuntimeError         `json:"error"`
	RequestID               string                    `json:"request_id"`
	ContextUsage            map[string]any            `json:"context_usage"`
	FinalOutput             string                    `json:"final_output"`
	StructuredOutput        map[string]any            `json:"structured_output"`
	CompletedStep           map[string]any            `json:"completed_step"`
	Evidence                []map[string]any          `json:"evidence"`
	SourceAttempts          []map[string]any          `json:"source_attempts"`
	ModelName               string                    `json:"model_name"`
	ModelProvider           string                    `json:"model_provider"`
	ProviderResponseID      string                    `json:"provider_response_id"`
	StageTiming             map[string]any            `json:"stage_timing"`
	ToolResults             []agentToolResult         `json:"tool_results"`
	TerminalReason          string                    `json:"terminal_reason"`
	ToolContractFingerprint map[string]any            `json:"tool_contract_fingerprint"`
	RuntimeRelease          string                    `json:"runtime_release"`
	Usage                   agentRuntimeUsage         `json:"usage"`
	WebCitations            []agentRuntimeWebCitation `json:"web_citations"`
	WebSearchUsed           bool                      `json:"web_search_used"`
}

type agentRuntimeWebCitation struct {
	EndIndex   int    `json:"end_index"`
	StartIndex int    `json:"start_index"`
	Title      string `json:"title"`
	URL        string `json:"url"`
}

type agentToolResult struct {
	ArgumentsJSON map[string]any                    `json:"arguments_json"`
	StartedAt     *time.Time                        `json:"started_at"`
	CompletedAt   *time.Time                        `json:"completed_at"`
	DurationMS    float64                           `json:"duration_ms"`
	Failure       *temporalruntime.ExecutionFailure `json:"failure"`
	InvocationID  string                            `json:"invocation_id"`
	Status        string                            `json:"status"`
	ToolName      string                            `json:"tool_name"`
	Result        map[string]any                    `json:"result"`
}

type agentRuntimeUsage struct {
	ModelRequestCount int64 `json:"model_request_count"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type agentRuntimeError struct {
	Code         string `json:"code"`
	Message      string `json:"message"`
	Operation    string `json:"operation"`
	Detail       string `json:"detail"`
	HTTPStatus   int    `json:"http_status"`
	InvocationID string `json:"invocation_id"`
}

type agentRuntimeHTTPError struct {
	StatusCode     int
	Code           string
	Operation      string
	Detail         string
	InvocationID   string
	RuntimeRelease string
}

func (err agentRuntimeHTTPError) Error() string {
	switch strings.TrimSpace(err.Code) {
	case "provider_rate_limited", "provider_http_failed", "provider_connection_failed", "provider_timeout", "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "agent_deadline_exceeded", "context_budget_exceeded", "max_turns_exceeded":
		return "The agent runtime could not complete the request."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	case "tool_contract_mismatch":
		return "The admitted tool contract does not match the agent runtime."
	case "run_failed":
		return "The agent runtime could not complete the request."
	}
	if err.StatusCode >= http.StatusInternalServerError {
		return fmt.Sprintf("agent runtime returned HTTP %d", err.StatusCode)
	}
	return "The agent runtime request was rejected."
}

type agentRuntimeApplicationError struct {
	Code           string
	Operation      string
	Detail         string
	HTTPStatus     int
	InvocationID   string
	RuntimeRelease string
}

func (err agentRuntimeApplicationError) Error() string {
	return agentRuntimeHTTPError{Code: err.Code, Detail: err.Detail}.Error()
}
