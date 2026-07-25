package httpapi

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const primaryAgentTransportGraceMS = 5000

const (
	defaultAgentDeadlineMS        = 90000
	defaultAgentMaxOutputTokens   = 2048
	defaultAgentMaxTurns          = 6
	defaultAgentCurrentInputChars = 8000
	defaultAgentContextChars      = 16000
)

type primaryAgentRuntimeLimits struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxKnowledgeSearches  int
	MaxOutputTokens       int
	MaxTurns              int
}

type primaryAgentContextPolicyStats struct {
	DroppedCategoryCounts   map[string]any
	ModelVisibleAfterCount  int
	ModelVisibleBeforeCount int
	ContextCharsAfter       int
	ContextCharsBefore      int
	CurrentInputChars       int
}

func (s *Server) primaryAgentRuntimeLimits() primaryAgentRuntimeLimits {
	return primaryAgentRuntimeLimits{
		AgentDeadlineMS:       positiveOrDefault(s.config.AgentRuntimeDeadlineMS, defaultAgentDeadlineMS),
		ContextCharLimit:      positiveOrDefault(s.config.AgentRuntimeContextCharLimit, defaultAgentContextChars),
		CurrentInputCharLimit: positiveOrDefault(s.config.AgentRuntimeInputCharLimit, defaultAgentCurrentInputChars),
		MaxKnowledgeSearches:  positiveOrDefault(s.config.AgentRuntimeSearchLimit, config.MaxKnowledgeSearches),
		MaxOutputTokens:       positiveOrDefault(s.config.AgentRuntimeMaxOutputTokens, defaultAgentMaxOutputTokens),
		MaxTurns:              positiveOrDefault(s.config.AgentRuntimeMaxTurns, defaultAgentMaxTurns),
	}
}

func primaryAgentRuntimeLimitsPayload(limits primaryAgentRuntimeLimits) map[string]any {
	return map[string]any{
		"agent_deadline_ms":        limits.AgentDeadlineMS,
		"context_char_limit":       limits.ContextCharLimit,
		"current_input_char_limit": limits.CurrentInputCharLimit,
		"max_knowledge_searches":   limits.MaxKnowledgeSearches,
		"max_output_tokens":        limits.MaxOutputTokens,
		"max_turns":                limits.MaxTurns,
	}
}

func positiveOrDefault(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func temporalMemoryContextPayload(context *temporalruntime.MemoryContext) map[string]any {
	if context == nil || strings.TrimSpace(context.ContextBlock) == "" || strings.TrimSpace(context.MemoryRef) == "" {
		return nil
	}
	payload := map[string]any{
		"context_block":         context.ContextBlock,
		"memory_ref":            context.MemoryRef,
		"schema_version":        context.SchemaVersion,
		"selected_memory_chars": context.SelectedMemoryChars,
		"selected_memory_count": context.SelectedMemoryCount,
	}
	if provider := strings.TrimSpace(context.Provider); provider != "" {
		payload["provider"] = provider
	}
	if retrievalMode := strings.TrimSpace(context.RetrievalMode); retrievalMode != "" {
		payload["retrieval_mode"] = retrievalMode
	}
	return payload
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
	limits primaryAgentRuntimeLimits,
) (map[string]any, error) {
	executionPayload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	currentInput := strings.TrimSpace(primaryAgentInputText(run))
	currentInputChars := len([]rune(currentInput))
	if currentInputChars > limits.CurrentInputCharLimit {
		return nil, fmt.Errorf(
			"current user input has %d characters, limit is %d",
			currentInputChars,
			limits.CurrentInputCharLimit,
		)
	}
	conversation := cloneAnyMapFromMetadata(nestedAny(executionPayload, "context", "conversation"))
	if len(conversation) == 0 {
		return nil, nil
	}
	context := map[string]any{
		"schema_version":        "final_model_context.v2",
		"recent_turns":          primaryAgentNormalizedRecentTurns(conversation),
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
	contextCharsBefore, err := primaryAgentContextCharacterCount(beforeContext)
	if err != nil {
		return nil, err
	}
	droppedCategoryCounts, contextCharsAfter, err := primaryAgentApplyContextBudget(
		context,
		limits.ContextCharLimit,
	)
	if err != nil {
		return nil, err
	}
	stats := primaryAgentContextPolicyStats{
		DroppedCategoryCounts:   droppedCategoryCounts,
		ModelVisibleAfterCount:  primaryAgentModelVisibleItemCount(context),
		ModelVisibleBeforeCount: primaryAgentModelVisibleItemCount(beforeContext),
		ContextCharsAfter:       contextCharsAfter,
		ContextCharsBefore:      contextCharsBefore,
		CurrentInputChars:       currentInputChars,
	}
	context["usage_summary"] = primaryAgentFinalModelUsageSummary(input, stats)
	return context, nil
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
		"context_chars":            stats.ContextCharsAfter,
		"current_input_chars":      stats.CurrentInputChars,
		"memory_recall_state":      memoryRecallState,
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
		"policy_version":             "primary_agent_context.v2",
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

func primaryAgentModelVisibleItemCount(context map[string]any) int {
	count := 0
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
		if primaryAgentDropOldestListItem(context, "previous_tool_results") {
			incrementAnyCount(dropped, "previous_tool_results", 1)
			continue
		}
		if _, ok := context["memory_context"]; ok {
			delete(context, "memory_context")
			incrementAnyCount(dropped, "memory_context", 1)
			continue
		}
		if primaryAgentDropOldestRecentTurn(context, true) {
			incrementAnyCount(dropped, "recent_turns", 1)
			continue
		}
		if primaryAgentDropOldestEvidenceSnippet(context) {
			incrementAnyCount(dropped, "previous_evidence_snippets", 1)
			continue
		}
		if primaryAgentDropOldestRecentTurn(context, false) {
			incrementAnyCount(dropped, "recent_turns", 1)
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

func primaryAgentDropOldestListItem(context map[string]any, key string) bool {
	values := anyListFromAny(context[key])
	if len(values) == 0 {
		return false
	}
	context[key] = append([]any{}, values[1:]...)
	return true
}

func primaryAgentDropOldestRecentTurn(context map[string]any, preserveLatest bool) bool {
	turns := anyListFromAny(context["recent_turns"])
	if len(turns) == 0 || (preserveLatest && len(turns) == 1) {
		return false
	}
	context["recent_turns"] = append([]any{}, turns[1:]...)
	return true
}

func primaryAgentDropOldestEvidenceSnippet(context map[string]any) bool {
	evidence := anyListFromAny(context["previous_evidence"])
	for _, raw := range evidence {
		item := cloneAnyMapFromMetadata(raw)
		if firstNonEmptyText(item["snippet"]) == "" {
			continue
		}
		delete(item, "snippet")
		for index, candidate := range evidence {
			candidateMap := cloneAnyMapFromMetadata(candidate)
			if firstNonEmptyText(candidateMap["evidence_id"]) == firstNonEmptyText(item["evidence_id"]) {
				evidence[index] = item
				context["previous_evidence"] = evidence
				return true
			}
		}
	}
	return false
}

func incrementAnyCount(counts map[string]any, key string, delta int) {
	counts[key] = intFromAny(counts[key]) + delta
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
		"context_chars":              usage["context_chars"],
		"current_input_chars":        usage["current_input_chars"],
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
	SelectedTools          []string          `json:"selected_tools"`
	StageTiming            map[string]any    `json:"stage_timing"`
	ToolResults            []agentToolResult `json:"tool_results"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint"`
	Usage                  agentRuntimeUsage `json:"usage"`
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
	Message    string
}

func (err agentRuntimeHTTPError) Error() string {
	message := strings.TrimSpace(err.Message)
	if message == "" {
		return fmt.Sprintf("agent runtime returned HTTP %d", err.StatusCode)
	}
	return message
}
