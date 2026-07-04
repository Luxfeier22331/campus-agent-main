package httpapi

import (
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func temporalMemoryContextPayload(context *temporalruntime.MemoryContext) map[string]any {
	if context == nil || strings.TrimSpace(context.ContextBlock) == "" || strings.TrimSpace(context.MemoryRef) == "" {
		return nil
	}
	return map[string]any{
		"context_block":         context.ContextBlock,
		"memory_ref":            context.MemoryRef,
		"provider":              context.Provider,
		"retrieval_mode":        context.RetrievalMode,
		"schema_version":        context.SchemaVersion,
		"selected_memory_chars": context.SelectedMemoryChars,
		"selected_memory_count": context.SelectedMemoryCount,
	}
}

func primaryAgentFinalModelContextForRun(
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) map[string]any {
	executionPayload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	conversation := cloneAnyMapFromMetadata(nestedAny(executionPayload, "context", "conversation"))
	if len(conversation) == 0 {
		return nil
	}
	currentUserMessage := cloneAnyMapFromMetadata(conversation["current_user_message"])
	usageSummary := primaryAgentFinalModelUsageSummary(conversation, input)
	context := map[string]any{
		"schema_version":        "final_model_context.v1",
		"current_user_message":  strings.TrimSpace(firstNonEmptyText(currentUserMessage["content"], executionPayload["user_goal"])),
		"recent_turns":          primaryAgentRecentTurns(conversation),
		"previous_evidence":     primaryAgentPreviousEvidence(conversation),
		"previous_tool_results": primaryAgentPreviousToolResults(conversation),
		"usage_summary":         usageSummary,
	}
	if summary := firstNonEmptyText(conversation["previous_answer_summary"]); summary != "" {
		context["previous_answer_summary"] = summary
	}
	if sessionState := cloneAnyMapFromMetadata(conversation["session_state"]); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	if memoryContext := temporalMemoryContextPayload(input.MemoryContext); memoryContext != nil {
		context["memory_context"] = memoryContext
	}
	return context
}

func primaryAgentFinalModelUsageSummary(
	conversation map[string]any,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) map[string]any {
	visibility := cloneAnyMapFromMetadata(conversation["visibility"])
	budget := cloneAnyMapFromMetadata(conversation["budget"])
	truncation := cloneAnyMapFromMetadata(conversation["truncation"])
	memoryRecallState := "skipped"
	if temporalMemoryContextPayload(input.MemoryContext) != nil {
		memoryRecallState = "completed"
	}
	usage := map[string]any{
		"memory_recall_state":      memoryRecallState,
		"model_visible_item_count": len(anyListFromAny(visibility["model_visible"])),
		"runtime_only_item_count":  len(anyListFromAny(visibility["runtime_only"])),
		"token_estimate":           intFromAny(budget["token_estimate"]),
	}
	if reason := firstNonEmptyText(truncation["reason"]); reason != "" {
		usage["truncation_reason"] = reason
	}
	return usage
}

func primaryAgentRecentTurns(conversation map[string]any) []any {
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
		if content := firstNonEmptyText(turn["content"]); content != "" {
			item["content"] = content
		}
		if summary := firstNonEmptyText(turn["summary"]); summary != "" {
			item["summary"] = summary
		}
		result = append(result, item)
	}
	return result
}

func primaryAgentPreviousEvidence(conversation map[string]any) []any {
	refs := anyListFromAny(conversation["previous_evidence_refs"])
	result := make([]any, 0, len(refs))
	for _, raw := range refs {
		ref := cloneAnyMapFromMetadata(raw)
		evidenceID := firstNonEmptyText(ref["evidence_id"])
		sourceID := firstNonEmptyText(ref["source_id"])
		contentHash := firstNonEmptyText(ref["content_hash"])
		accessScope := firstNonEmptyText(ref["access_scope"])
		if evidenceID == "" || sourceID == "" || contentHash == "" || accessScope == "" {
			continue
		}
		item := map[string]any{
			"access_scope": accessScope,
			"content_hash": contentHash,
			"evidence_id":  evidenceID,
			"source_id":    sourceID,
		}
		copyOptionalString(item, ref, "document_id")
		copyOptionalString(item, ref, "section_title")
		copyOptionalString(item, ref, "snapshot_id")
		copyOptionalString(item, ref, "snippet")
		copyOptionalString(item, ref, "title")
		copyOptionalString(item, ref, "version_id")
		result = append(result, item)
	}
	return result
}

func primaryAgentPreviousToolResults(conversation map[string]any) []any {
	refs := anyListFromAny(conversation["previous_tool_results"])
	result := make([]any, 0, len(refs))
	for _, raw := range refs {
		ref := cloneAnyMapFromMetadata(raw)
		requestID := firstNonEmptyText(ref["request_id"])
		runID := firstNonEmptyText(ref["run_id"])
		tool := firstNonEmptyText(ref["tool"])
		resultKind := firstNonEmptyText(ref["result_kind"])
		projectionRef := firstNonEmptyText(ref["projection_ref"])
		contentHash := firstNonEmptyText(ref["content_hash"])
		status := firstNonEmptyText(ref["status"])
		if requestID == "" || runID == "" || tool == "" || resultKind == "" || projectionRef == "" || contentHash == "" || status == "" {
			continue
		}
		item := map[string]any{
			"request_id":     requestID,
			"run_id":         runID,
			"tool":           tool,
			"result_kind":    resultKind,
			"projection_ref": projectionRef,
			"content_hash":   contentHash,
			"status":         status,
		}
		copyOptionalString(item, ref, "summary")
		result = append(result, item)
	}
	return result
}

func primaryAgentContextUsageSummary(finalModelContext map[string]any) map[string]any {
	if len(finalModelContext) == 0 {
		return nil
	}
	usage := cloneAnyMapFromMetadata(finalModelContext["usage_summary"])
	summary := map[string]any{
		"schema_version":             finalModelContext["schema_version"],
		"recent_turn_count":          len(anyListFromAny(finalModelContext["recent_turns"])),
		"previous_evidence_count":    len(anyListFromAny(finalModelContext["previous_evidence"])),
		"previous_tool_result_count": len(anyListFromAny(finalModelContext["previous_tool_results"])),
		"memory_recall_state":        usage["memory_recall_state"],
		"model_visible_item_count":   usage["model_visible_item_count"],
		"runtime_only_item_count":    usage["runtime_only_item_count"],
		"token_estimate":             usage["token_estimate"],
	}
	if reason := firstNonEmptyText(usage["truncation_reason"]); reason != "" {
		summary["truncation_reason"] = reason
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
	Status             string            `json:"status"`
	DebugTraceRefs     []debugTraceRef   `json:"debug_trace_refs"`
	Error              agentRuntimeError `json:"error"`
	RunID              string            `json:"run_id"`
	FinalOutput        string            `json:"final_output"`
	ModelName          string            `json:"model_name"`
	ModelProvider      string            `json:"model_provider"`
	ProviderResponseID string            `json:"provider_response_id"`
	SDKTraceRef        string            `json:"sdk_trace_ref"`
	SelectedTools      []string          `json:"selected_tools"`
	StageTiming        map[string]any    `json:"stage_timing"`
	ToolResults        []agentToolResult `json:"tool_results"`
	TerminalEnvelope   map[string]any    `json:"terminal_envelope"`
	TerminalReason     string            `json:"terminal_reason"`
	Usage              agentRuntimeUsage `json:"usage"`
}

type debugTraceRef struct {
	Sink     string `json:"sink"`
	TraceID  string `json:"trace_id"`
	TraceRef string `json:"trace_ref"`
	URL      string `json:"url,omitempty"`
}

type agentToolResult struct {
	ArgumentsJSON   map[string]any `json:"arguments_json"`
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
	PayloadKind     string         `json:"payload_kind"`
	Result          map[string]any `json:"result"`
	ResultRef       string         `json:"result_ref"`
	FailCloseReason string         `json:"fail_close_reason"`
}

type agentRuntimeUsage struct {
	InputTokens           int64 `json:"input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	EstimatedCostMicroUSD int64 `json:"estimated_cost_micro_usd"`
}

type agentRuntimeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type agentRuntimeHTTPError struct {
	StatusCode int
	Code       string
	Message    string
}

func (err agentRuntimeHTTPError) Error() string {
	message := strings.TrimSpace(err.Message)
	if message == "" {
		return fmt.Sprintf("agent runtime returned HTTP %d", err.StatusCode)
	}
	return message
}
