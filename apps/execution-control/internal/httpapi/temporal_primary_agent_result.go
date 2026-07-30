package httpapi

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
	outcome := strings.TrimSpace(stringValue(value))
	if len(outcome) > 128 {
		return outcome[:128]
	}
	return outcome
}

type primaryAgentResultInput struct {
	activityAttempt        int
	activityInput          temporalruntime.ExecutePrimaryAgentActivityInput
	groundingContextSHA256 string
	run                    execution.DurableRun
}

func primaryAgentResultPayload(
	input primaryAgentResultInput,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (map[string]any, error) {
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for index, result := range output.ToolResults {
		durationMS, err := primaryAgentToolDurationMS(result.DurationMS)
		if err != nil {
			return nil, err
		}
		argumentMetadata, err := validateSDKToolArguments(result.ToolName, result.ArgumentsJSON)
		if err != nil {
			return nil, err
		}
		resultBody := cloneAnyMapFromMetadata(result.Result)
		envelope, err := sdkToolResultEnvelopeForProjection(
			result.ToolName,
			result.PayloadKind,
			result.Status,
			resultBody,
			primaryAgentSDKToolProjectionRef(input.run.RunID, result.ToolName, index+1),
		)
		if err != nil {
			return nil, err
		}
		if len(envelope) > 0 {
			resultBody["result_envelope"] = envelope
		}
		toolResults = append(toolResults, map[string]any{
			"arguments_json":           cloneAnyMapFromMetadata(result.ArgumentsJSON),
			"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
			"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
			"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
			"duration_ms":              durationMS,
			"fail_close_reason":        result.FailCloseReason,
			"payload_kind":             result.PayloadKind,
			"result":                   resultBody,
			"result_ref":               result.ResultRef,
			"status":                   result.Status,
			"tool_name":                result.ToolName,
		})
	}
	payload := map[string]any{
		"activity_attempt":          input.activityAttempt,
		"admission_snapshot_sha256": sha256JSONRef(input.activityInput.AdmissionSnapshot),
		"allow_ungrounded_answer": input.activityInput.AdmissionSnapshot.ExecutionStrategy.
			AllowUngroundedAnswer,
		"embedding_provider_admission": embeddingProviderAdmissionPin(
			input.activityInput.AdmissionSnapshot,
		).projectionPayload(),
		"agent_result_ref":         output.AgentResultRef,
		"final_output":             output.FinalOutput,
		"grounding_context_ref":    groundingContextRef(input.run.RunID),
		"grounding_context_sha256": input.groundingContextSHA256,
		"model_name":               output.ModelName,
		"model_provider":           output.ModelProvider,
		"prompt_trace":             cloneAnyMapFromMetadata(output.PromptTrace),
		"provider_response_id":     output.ProviderResponseID,
		"stage_timing":             cloneAnyMapFromMetadata(output.StageTiming),
		"status":                   output.Status,
		"terminal_envelope":        cloneAnyMapFromMetadata(output.TerminalEnvelope),
		"terminal_reason":          output.TerminalReason,
		"tool_results":             toolResults,
		"tool_runtime_fingerprint": cloneAnyMapFromMetadata(
			output.ToolRuntimeFingerprint,
		),
		"usage": map[string]any{
			"model_request_count": output.Usage.ModelRequestCount,
			"cached_input_tokens": output.Usage.CachedInputTokens,
			"input_tokens":        output.Usage.InputTokens,
			"output_tokens":       output.Usage.OutputTokens,
			"usage_observed":      output.Usage.UsageObserved,
		},
	}
	if expected := toolRuntimeFingerprintSnapshotMap(
		input.activityInput.AdmissionSnapshot.ToolRuntimeFingerprint,
	); expected != nil {
		payload["admitted_tool_runtime_fingerprint"] = expected
	}
	return payload, nil
}

func primaryAgentFinalizationResultMap(
	input temporalruntime.WriteFinalizationActivityInput,
) map[string]any {
	output := input.AgentResult
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		toolResults = append(toolResults, map[string]any{
			"arguments_json":    cloneAnyMapFromMetadata(result.ArgumentsJSON),
			"duration_ms":       result.DurationMS,
			"fail_close_reason": result.FailCloseReason,
			"payload_kind":      result.PayloadKind,
			"result":            cloneAnyMapFromMetadata(result.Result),
			"result_ref":        result.ResultRef,
			"status":            result.Status,
			"tool_name":         result.ToolName,
		})
	}
	result := map[string]any{
		"admission_snapshot_sha256": sha256JSONRef(input.AdmissionSnapshot),
		"agent_result_ref":          output.AgentResultRef,
		"allow_ungrounded_answer": input.AdmissionSnapshot.ExecutionStrategy.
			AllowUngroundedAnswer,
		"final_output":             output.FinalOutput,
		"grounding_context_ref":    groundingContextRef(input.RunID),
		"grounding_context_sha256": sha256JSONRef(output.GroundingContext),
		"model_name":               output.ModelName,
		"model_provider":           output.ModelProvider,
		"prompt_trace":             cloneAnyMapFromMetadata(output.PromptTrace),
		"provider_response_id":     output.ProviderResponseID,
		"stage_timing":             cloneAnyMapFromMetadata(output.StageTiming),
		"status":                   output.Status,
		"terminal_envelope":        cloneAnyMapFromMetadata(output.TerminalEnvelope),
		"terminal_reason":          output.TerminalReason,
		"tool_results":             toolResults,
		"tool_runtime_fingerprint": cloneAnyMapFromMetadata(output.ToolRuntimeFingerprint),
		"usage": map[string]any{
			"model_request_count": output.Usage.ModelRequestCount,
			"cached_input_tokens": output.Usage.CachedInputTokens,
			"input_tokens":        output.Usage.InputTokens,
			"output_tokens":       output.Usage.OutputTokens,
			"usage_observed":      output.Usage.UsageObserved,
		},
	}
	if expected := toolRuntimeFingerprintSnapshotMap(input.AdmissionSnapshot.ToolRuntimeFingerprint); expected != nil {
		result["admitted_tool_runtime_fingerprint"] = expected
	}
	return result
}

// primaryAgentResultProjectionPayload is the bounded, non-sensitive view that
// is copied to run steps and attempts. The complete result stays in the
// workflow's typed Activity result.
func primaryAgentResultProjectionPayload(raw map[string]any) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		"activity_attempt", "agent_result_ref", "model_name", "model_provider",
		"admission_snapshot_sha256", "context_usage", "embedding_provider_admission",
		"grounding_context_ref", "grounding_context_sha256",
		"grounding_mode", "grounding_selected_scopes", "grounding_covered_scopes", "grounding_status",
		"provider_response_id", "stage_timing", "status",
		"terminal_reason", "tool_runtime_fingerprint", "admitted_tool_runtime_fingerprint",
		"usage", "provider_invocation_sha256",
	} {
		if value, ok := raw[key]; ok {
			result[key] = value
		}
	}
	result["temporal_result"] = true
	if finalOutput, ok := raw["final_output"].(string); ok {
		result["final_output_sha256"] = sha256AnyValue(finalOutput)
	}
	if envelope, ok := raw["terminal_envelope"]; ok {
		result["terminal_envelope_sha256"] = sha256AnyValue(envelope)
	}
	if tools, ok := raw["tool_results"]; ok {
		result["tool_results_sha256"] = sha256AnyValue(tools)
	}
	if trace, ok := raw["prompt_trace"]; ok {
		result["prompt_trace_sha256"] = sha256AnyValue(trace)
	}
	return result
}

func primaryAgentToolDurationMS(value float64) (int64, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value > float64((1<<63)-1) {
		return 0, fmt.Errorf("agent runtime tool duration_ms is invalid")
	}
	return int64(math.Ceil(value)), nil
}

func numericProjectionValue(value any) float64 {
	numeric, _ := numericValue(value)
	return numeric
}

func primaryAgentSDKToolProjectionRef(runID string, toolName string, callIndex int) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%d", toolName, callIndex))
}
