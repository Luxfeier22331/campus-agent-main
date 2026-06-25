package httpapi

import (
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func primaryAgentResultPayload(
	runID string,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (map[string]any, error) {
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for index, result := range output.ToolResults {
		resultBody := cloneAnyMapFromMetadata(result.Result)
		envelope, err := sdkToolResultEnvelopeForProjection(
			result.ToolName,
			result.Capability,
			result.PayloadKind,
			result.Status,
			resultBody,
			primaryAgentSDKToolProjectionRef(runID, result.ToolName, index+1),
		)
		if err != nil {
			return nil, err
		}
		if len(envelope) > 0 {
			resultBody["result_envelope"] = envelope
		}
		toolResults = append(toolResults, map[string]any{
			"arguments_json":    cloneAnyMapFromMetadata(result.ArgumentsJSON),
			"capability":        result.Capability,
			"fail_close_reason": result.FailCloseReason,
			"payload_kind":      result.PayloadKind,
			"result":            resultBody,
			"result_ref":        result.ResultRef,
			"status":            result.Status,
			"tool_name":         result.ToolName,
		})
	}
	return map[string]any{
		"agent_result_ref":     output.AgentResultRef,
		"final_output":         output.FinalOutput,
		"model_name":           output.ModelName,
		"model_provider":       output.ModelProvider,
		"provider_response_id": output.ProviderResponseID,
		"sdk_trace_ref":        output.SDKTraceRef,
		"selected_tools":       append([]string{}, output.SelectedTools...),
		"terminal_envelope":    cloneAnyMapFromMetadata(output.TerminalEnvelope),
		"terminal_reason":      output.TerminalReason,
		"tool_results":         toolResults,
		"usage": map[string]any{
			"cached_input_tokens":      output.Usage.CachedInputTokens,
			"estimated_cost_micro_usd": output.Usage.EstimatedCostMicroUSD,
			"input_tokens":             output.Usage.InputTokens,
			"output_tokens":            output.Usage.OutputTokens,
		},
	}, nil
}

func primaryAgentSDKToolProjectionRef(runID string, toolName string, callIndex int) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%d", toolName, callIndex))
}
