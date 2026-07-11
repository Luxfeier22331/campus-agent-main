package httpapi

import (
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	primaryAgentRecentTurnLimit = 6
	primaryAgentTurnCharLimit   = 240
)

type primaryAgentContextPolicyStats struct {
	DroppedCategoryCounts   map[string]any
	ModelVisibleAfterCount  int
	ModelVisibleBeforeCount int
	TokenEstimateAfter      int
	TokenEstimateBefore     int
}

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

func temporalMemoryContextProjectionPayload(context *temporalruntime.MemoryContext) map[string]any {
	if context == nil || strings.TrimSpace(context.MemoryRef) == "" {
		return nil
	}
	return map[string]any{
		"context_block_sha256":    sha256TextRef(context.ContextBlock),
		"memory_ref":              strings.TrimSpace(context.MemoryRef),
		"provider":                strings.TrimSpace(context.Provider),
		"retrieval_mode":          strings.TrimSpace(context.RetrievalMode),
		"schema_version":          strings.TrimSpace(context.SchemaVersion),
		"selected_memory_chars":   context.SelectedMemoryChars,
		"selected_memory_count":   context.SelectedMemoryCount,
		"selected_memory_present": strings.TrimSpace(context.ContextBlock) != "",
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
	rawRecentTurns := primaryAgentNormalizedRecentTurns(conversation)
	recentTurns, droppedCategoryCounts := primaryAgentBoundRecentTurns(rawRecentTurns)
	context := map[string]any{
		"schema_version":        "final_model_context.v1",
		"current_user_message":  strings.TrimSpace(firstNonEmptyText(currentUserMessage["content"], executionPayload["user_goal"])),
		"recent_turns":          recentTurns,
		"previous_evidence":     primaryAgentPreviousEvidence(conversation),
		"previous_tool_results": primaryAgentPreviousToolResults(conversation),
	}
	if sessionState := cloneAnyMapFromMetadata(conversation["session_state"]); len(sessionState) > 0 {
		context["session_state"] = sessionState
	}
	if memoryContext := temporalMemoryContextPayload(input.MemoryContext); memoryContext != nil {
		context["memory_context"] = memoryContext
	}
	beforeContext := cloneAnyMapFromMetadata(context)
	beforeContext["recent_turns"] = rawRecentTurns
	stats := primaryAgentContextPolicyStats{
		DroppedCategoryCounts:   droppedCategoryCounts,
		ModelVisibleAfterCount:  primaryAgentModelVisibleItemCount(context),
		ModelVisibleBeforeCount: primaryAgentModelVisibleItemCount(beforeContext),
		TokenEstimateAfter:      primaryAgentContextTokenEstimate(context),
		TokenEstimateBefore:     primaryAgentContextTokenEstimate(beforeContext),
	}
	context["usage_summary"] = primaryAgentFinalModelUsageSummary(input, stats)
	return context
}

func primaryAgentFinalModelUsageSummary(
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	stats primaryAgentContextPolicyStats,
) map[string]any {
	memoryRecallState := "skipped"
	if temporalMemoryContextPayload(input.MemoryContext) != nil {
		memoryRecallState = "completed"
	}
	usage := map[string]any{
		"memory_recall_state":      memoryRecallState,
		"model_visible_item_count": stats.ModelVisibleAfterCount,
		"runtime_only_item_count":  0,
		"token_estimate":           stats.TokenEstimateAfter,
	}
	if len(stats.DroppedCategoryCounts) > 0 {
		usage["truncation_reason"] = "context_policy_limit"
		usage["truncation_summary"] = primaryAgentTruncationSummary(stats)
	}
	return usage
}

func primaryAgentTruncationSummary(stats primaryAgentContextPolicyStats) map[string]any {
	return map[string]any{
		"schema_version":             "truncation_summary.v1",
		"policy_version":             "primary_agent_context.v1",
		"reason":                     "context_policy_limit",
		"model_visible_before_count": stats.ModelVisibleBeforeCount,
		"model_visible_after_count":  stats.ModelVisibleAfterCount,
		"runtime_only_before_count":  0,
		"runtime_only_after_count":   0,
		"token_estimate_before":      stats.TokenEstimateBefore,
		"token_estimate_after":       stats.TokenEstimateAfter,
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

func primaryAgentBoundRecentTurns(turns []any) ([]any, map[string]any) {
	dropped := map[string]any{}
	start := 0
	if len(turns) > primaryAgentRecentTurnLimit {
		start = len(turns) - primaryAgentRecentTurnLimit
		dropped["recent_turns"] = start
	}
	result := make([]any, 0, len(turns)-start)
	droppedCharacters := 0
	for _, raw := range turns[start:] {
		turn := cloneAnyMapFromMetadata(raw)
		content, removed := primaryAgentBoundTurnContent(firstNonEmptyText(turn["content"]))
		turn["content"] = content
		droppedCharacters += removed
		result = append(result, turn)
	}
	if droppedCharacters > 0 {
		dropped["recent_turn_characters"] = droppedCharacters
	}
	return result, dropped
}

func primaryAgentBoundTurnContent(value string) (string, int) {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= primaryAgentTurnCharLimit {
		return value, 0
	}
	keptRuneCount := primaryAgentTurnCharLimit - 3
	return string(runes[:keptRuneCount]) + "...", len(runes) - keptRuneCount
}

func primaryAgentModelVisibleItemCount(context map[string]any) int {
	count := 0
	if firstNonEmptyText(context["current_user_message"]) != "" {
		count++
	}
	count += len(anyListFromAny(context["recent_turns"]))
	count += len(anyListFromAny(context["previous_evidence"]))
	count += len(anyListFromAny(context["previous_tool_results"]))
	if len(cloneAnyMapFromMetadata(context["session_state"])) > 0 {
		count++
	}
	if len(cloneAnyMapFromMetadata(context["memory_context"])) > 0 {
		count++
	}
	return count
}

func primaryAgentContextTokenEstimate(context map[string]any) int {
	runeCount := primaryAgentContextRuneCount(context)
	return (runeCount + 3) / 4
}

func primaryAgentContextRuneCount(value any) int {
	switch typed := value.(type) {
	case string:
		return len([]rune(strings.TrimSpace(typed)))
	case map[string]any:
		total := 0
		for _, item := range typed {
			total += primaryAgentContextRuneCount(item)
		}
		return total
	case []any:
		total := 0
		for _, item := range typed {
			total += primaryAgentContextRuneCount(item)
		}
		return total
	case []string:
		total := 0
		for _, item := range typed {
			total += primaryAgentContextRuneCount(item)
		}
		return total
	default:
		return 0
	}
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
	DebugTraceRefs         []debugTraceRef   `json:"debug_trace_refs"`
	Error                  agentRuntimeError `json:"error"`
	RunID                  string            `json:"run_id"`
	FinalOutput            string            `json:"final_output"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace"`
	ProviderResponseID     string            `json:"provider_response_id"`
	SDKTraceRef            string            `json:"sdk_trace_ref"`
	SelectedTools          []string          `json:"selected_tools"`
	StageTiming            map[string]any    `json:"stage_timing"`
	ToolResults            []agentToolResult `json:"tool_results"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint"`
	Usage                  agentRuntimeUsage `json:"usage"`
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
