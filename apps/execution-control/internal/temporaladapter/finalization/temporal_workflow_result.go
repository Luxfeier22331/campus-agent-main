package finalization

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func WorkflowFinalizationResultMap(
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) map[string]any {
	output := input.WorkflowResult
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		toolResults = append(toolResults, WorkflowToolResultMap(result, result.DurationMS))
	}
	result := map[string]any{
		"admission_snapshot_sha256": execution.SHA256JSONRef(input.AdmissionSnapshot),
		"workflow_result_ref":       output.WorkflowResultRef,
		"agent_runtime_release":     output.RuntimeRelease,
		"final_output":              output.FinalOutput,
		"solve_outcome":             output.SolveOutcome,
		"model_name":                output.ModelName,
		"model_provider":            output.ModelProvider,
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
		"web_evidence": output.WebEvidence,
	}
	if operation := strings.TrimSpace(string(output.Operation)); operation != "" {
		result["operation"] = operation
	}
	if output.Evidence != nil {
		result["evidence"] = append([]temporalruntime.WorkflowEvidence{}, output.Evidence...)
	}
	if output.SourceAttempts != nil {
		result["source_attempts"] = append([]temporalruntime.WorkflowSourceAttempt{}, output.SourceAttempts...)
	}
	if expected := execution.ToolContractFingerprintSnapshotMap(execution.ToolContractFingerprintSnapshot(input.AdmissionSnapshot.ToolContractFingerprint)); expected != nil {
		result["admitted_tool_contract_fingerprint"] = expected
	}
	return result
}

func WorkflowToolResultMap(
	result temporalruntime.AgentToolResult,
	durationMS float64,
) map[string]any {
	toolResult := map[string]any{
		"duration_ms":   durationMS,
		"invocation_id": result.InvocationID,
		"result":        execution.CloneAnyMapFromValue(result.Result),
		"status":        result.Status,
		"tool_name":     result.ToolName,
	}
	if result.StartedAt != nil {
		toolResult["started_at"] = result.StartedAt.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
	}
	if result.CompletedAt != nil {
		toolResult["completed_at"] = result.CompletedAt.UTC().Truncate(time.Microsecond).Format(time.RFC3339Nano)
	}
	if result.Failure != nil {
		toolResult["failure"] = result.Failure
	}
	return toolResult
}

func NumericValue(value any) (float64, bool) {
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

func NumericProjectionValue(value any) float64 {
	numeric, _ := NumericValue(value)
	return numeric
}
