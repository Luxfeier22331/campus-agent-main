package temporaladapter

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
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

type primaryAgentResultInput struct {
	activityAttempt         int
	activityInput           temporalruntime.ExecutePrimaryAgentActivityInput
	executionControlRelease string
	run                     execution.DurableRun
}

func primaryAgentResultPayload(
	input primaryAgentResultInput,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (map[string]any, error) {
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		durationMS, err := primaryAgentToolDurationMS(result.DurationMS)
		if err != nil {
			return nil, err
		}
		toolResults = append(toolResults, primaryAgentToolResultMap(result, float64(durationMS)))
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
	payload := map[string]any{
		"activity_attempt":          input.activityAttempt,
		"admission_snapshot_sha256": execution.SHA256JSONRef(input.activityInput.AdmissionSnapshot),
		"agent_result_ref":          output.AgentResultRef,
		"agent_runtime_release":     output.RuntimeRelease,
		"context_usage":             execution.CloneAnyMapFromValue(output.ContextUsage),
		"execution_control_release": input.executionControlRelease,
		"final_output":              output.FinalOutput,
		"model_name":                output.ModelName,
		"model_provider":            output.ModelProvider,
		"prompt_trace":              execution.CloneAnyMapFromValue(output.PromptTrace),
		"provider_response_id":      output.ProviderResponseID,
		"stage_timing":              execution.CloneAnyMapFromValue(output.StageTiming),
		"status":                    output.Status,
		"terminal_reason":           output.TerminalReason,
		"tool_results":              toolResults,
		"tool_contract_fingerprint": execution.CloneAnyMapFromValue(
			output.ToolContractFingerprint,
		),
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
	if expected := execution.ToolContractFingerprintSnapshotMap(
		input.activityInput.AdmissionSnapshot.ToolContractFingerprint,
	); expected != nil {
		payload["admitted_tool_contract_fingerprint"] = expected
	}
	return payload, nil
}

func primaryAgentFinalizationResultMap(
	input temporalruntime.WriteFinalizationActivityInput,
) map[string]any {
	output := input.AgentResult
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		toolResults = append(toolResults, primaryAgentToolResultMap(result, result.DurationMS))
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
		"agent_result_ref":          output.AgentResultRef,
		"agent_runtime_release":     output.RuntimeRelease,
		"context_usage":             execution.CloneAnyMapFromValue(output.ContextUsage),
		"final_output":              output.FinalOutput,
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
	if expected := execution.ToolContractFingerprintSnapshotMap(input.AdmissionSnapshot.ToolContractFingerprint); expected != nil {
		result["admitted_tool_contract_fingerprint"] = expected
	}
	return result
}

func primaryAgentToolResultMap(
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

// primaryAgentResultProjectionPayload is the bounded, non-sensitive view that
// is copied to run steps and attempts. The complete result stays in the
// workflow's typed Activity result.
func primaryAgentResultProjectionPayload(raw map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		"activity_attempt", "agent_result_ref", "model_name", "model_provider",
		"admission_snapshot_sha256", "context_usage",
		"provider_response_id", "stage_timing", "status",
		"agent_runtime_release", "execution_control_release", "terminal_reason",
		"tool_contract_fingerprint", "admitted_tool_contract_fingerprint",
		"usage", "provider_invocation_sha256", "web_search_used",
	} {
		if value, ok := raw[key]; ok {
			result[key] = value
		}
	}
	result["temporal_result"] = true
	if finalOutput, ok := raw["final_output"].(string); ok {
		result["final_output_sha256"] = sha256AnyValue(finalOutput)
	}
	if tools, ok := raw["tool_results"]; ok {
		result["tool_results_sha256"] = sha256AnyValue(tools)
	}
	if trace, ok := raw["prompt_trace"]; ok {
		result["prompt_trace_sha256"] = sha256AnyValue(trace)
	}
	if citations, ok := raw["web_citations"]; ok {
		result["web_citations_sha256"] = sha256AnyValue(citations)
	}
	return result
}

func primaryAgentToolDurationMS(value float64) (int64, error) {
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

func primaryAgentToolProjectionRef(runID string, toolName string, invocationID string) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%s", toolName, invocationID))
}
