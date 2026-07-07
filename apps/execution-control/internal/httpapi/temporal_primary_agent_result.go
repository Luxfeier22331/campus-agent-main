package httpapi

import (
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func primaryAgentResultPayload(
	input primaryAgentFingerprintInput,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (map[string]any, error) {
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for index, result := range output.ToolResults {
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
			"arguments_json_sha256":    argumentMetadata.ArgumentsJSONSHA256,
			"arguments_schema_sha256":  argumentMetadata.ArgumentsSchemaSHA256,
			"arguments_schema_version": argumentMetadata.ArgumentsSchemaVersion,
			"fail_close_reason":        result.FailCloseReason,
			"payload_kind":             result.PayloadKind,
			"result":                   resultBody,
			"result_ref":               result.ResultRef,
			"status":                   result.Status,
			"tool_name":                result.ToolName,
		})
	}
	llmIOFingerprint, err := primaryAgentLLMIOFingerprint(input, output)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"agent_result_ref":       output.AgentResultRef,
		"debug_trace_refs":       debugTraceRefsPayload(output.DebugTraceRefs),
		"final_output":           output.FinalOutput,
		"llm_io_fingerprint":     llmIOFingerprint,
		"memory_context_summary": temporalMemoryContextProjectionPayload(input.activityInput.MemoryContext),
		"model_name":             output.ModelName,
		"model_provider":         output.ModelProvider,
		"provider_response_id":   output.ProviderResponseID,
		"sdk_trace_ref":          output.SDKTraceRef,
		"selected_tools":         append([]string{}, output.SelectedTools...),
		"stage_timing":           cloneAnyMapFromMetadata(output.StageTiming),
		"terminal_envelope":      cloneAnyMapFromMetadata(output.TerminalEnvelope),
		"terminal_reason":        output.TerminalReason,
		"tool_results":           toolResults,
		"usage": map[string]any{
			"cached_input_tokens":      output.Usage.CachedInputTokens,
			"estimated_cost_micro_usd": output.Usage.EstimatedCostMicroUSD,
			"input_tokens":             output.Usage.InputTokens,
			"output_tokens":            output.Usage.OutputTokens,
		},
	}, nil
}

func debugTraceRefsPayload(refs []temporalruntime.DebugTraceRef) []map[string]any {
	result := make([]map[string]any, 0, len(refs))
	for _, ref := range refs {
		sink := strings.TrimSpace(ref.Sink)
		traceRef := strings.TrimSpace(ref.TraceRef)
		if sink == "" || traceRef == "" {
			continue
		}
		item := map[string]any{
			"sink":      sink,
			"trace_ref": traceRef,
		}
		if traceID := strings.TrimSpace(ref.TraceID); traceID != "" {
			item["trace_id"] = traceID
		}
		if url := strings.TrimSpace(ref.URL); url != "" {
			item["url"] = url
		}
		result = append(result, item)
	}
	return result
}

func primaryAgentSDKToolProjectionRef(runID string, toolName string, callIndex int) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%d", toolName, callIndex))
}
