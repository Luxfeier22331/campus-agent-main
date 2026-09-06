package temporaladapter

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"math"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func sha256AnyValue(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func sha256Bytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func boundedToolOutcome(value any) string {
	outcome := strings.TrimSpace(execution.StringValue(value))
	if len(outcome) > 128 {
		return outcome[:128]
	}
	return outcome
}

func workflowFinalizationResultMap(
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) map[string]any {
	output := input.WorkflowResult
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		toolResults = append(toolResults, workflowToolResultMap(result, result.DurationMS))
	}
	webCitations := make([]map[string]any, 0, len(output.WebCitations))
	for _, citation := range output.WebCitations {
		webCitations = append(webCitations, map[string]any{
			"end_index":   citation.EndIndex,
			"start_index": citation.StartIndex,
			"title":       citation.Title,
			"url":         citation.URL,
		})
	}
	result := map[string]any{
		"admission_snapshot_sha256": execution.SHA256JSONRef(input.AdmissionSnapshot),
		"workflow_result_ref":       output.WorkflowResultRef,
		"agent_runtime_release":     output.RuntimeRelease,
		"context_usage":             execution.CloneAnyMapFromValue(output.ContextUsage),
		"final_output":              output.FinalOutput,
		"solve_outcome":             output.SolveOutcome,
		"model_name":                output.ModelName,
		"model_provider":            output.ModelProvider,
		"prompt_trace":              execution.CloneAnyMapFromValue(output.PromptTrace),
		"provider_response_id":      output.ProviderResponseID,
		"stage_timing":              execution.CloneAnyMapFromValue(output.StageTiming),
		"status":                    output.Status,
		"terminal_reason":           output.TerminalReason,
		"tool_results":              toolResults,
		"tool_contract_fingerprint": execution.CloneAnyMapFromValue(output.ToolContractFingerprint),
		"usage": map[string]any{
			"model_request_count": output.Usage.ModelRequestCount,
			"cached_input_tokens": output.Usage.CachedInputTokens,
			"input_tokens":        output.Usage.InputTokens,
			"output_tokens":       output.Usage.OutputTokens,
			"usage_observed":      output.Usage.UsageObserved,
		},
		"web_citations":   webCitations,
		"web_search_used": output.WebSearchUsed,
	}
	if operation := strings.TrimSpace(string(output.Operation)); operation != "" {
		result["operation"] = operation
	}
	if output.Evidence != nil {
		result["evidence"] = append([]temporalruntime.WorkflowEvidence{}, output.Evidence...)
	}
	if output.StructuredOutput != nil {
		result["structured_output"] = execution.CloneAnyMapFromValue(output.StructuredOutput)
	}
	if output.SourceAttempts != nil {
		result["source_attempts"] = append([]temporalruntime.WorkflowSourceAttempt{}, output.SourceAttempts...)
	}
	if expected := execution.ToolContractFingerprintSnapshotMap(input.AdmissionSnapshot.ToolContractFingerprint); expected != nil {
		result["admitted_tool_contract_fingerprint"] = expected
	}
	return result
}

func workflowToolResultMap(
	result temporalruntime.AgentToolResult,
	durationMS float64,
) map[string]any {
	toolResult := map[string]any{
		"arguments_json": execution.CloneAnyMapFromValue(result.ArgumentsJSON),
		"duration_ms":    durationMS,
		"invocation_id":  result.InvocationID,
		"result":         execution.CloneAnyMapFromValue(result.Result),
		"status":         result.Status,
		"tool_name":      result.ToolName,
	}
	if result.Failure != nil {
		toolResult["failure"] = result.Failure
	}
	return toolResult
}

func workflowToolDurationMS(value float64) (int64, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > float64((1<<63)-1) {
		return 0, fmt.Errorf("agent runtime tool duration_ms is invalid")
	}
	return int64(math.Ceil(value)), nil
}

func numericValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case float64:
		return typed, true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	default:
		return 0, false
	}
}

func numericProjectionValue(value any) float64 {
	numeric, _ := numericValue(value)
	return numeric
}

func workflowToolProjectionRef(runID string, toolName string, invocationID string) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%s", toolName, invocationID))
}
