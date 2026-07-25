package httpapi

import (
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type primaryAgentResultInput struct {
	activityAttempt int
	activityInput   temporalruntime.ExecutePrimaryAgentActivityInput
	run             execution.DurableRun
}

func primaryAgentResultPayload(
	input primaryAgentResultInput,
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
	return map[string]any{
		"activity_attempt":       input.activityAttempt,
		"agent_result_ref":       output.AgentResultRef,
		"final_output":           output.FinalOutput,
		"memory_context_summary": temporalMemoryContextProjectionPayload(input.activityInput.MemoryContext),
		"model_name":             output.ModelName,
		"model_provider":         output.ModelProvider,
		"prompt_trace":           cloneAnyMapFromMetadata(output.PromptTrace),
		"provider_response_id":   output.ProviderResponseID,
		"selected_tools":         append([]string{}, output.SelectedTools...),
		"stage_timing":           cloneAnyMapFromMetadata(output.StageTiming),
		"status":                 output.Status,
		"terminal_envelope":      cloneAnyMapFromMetadata(output.TerminalEnvelope),
		"terminal_reason":        output.TerminalReason,
		"tool_results":           toolResults,
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
	}, nil
}

func primaryAgentSDKToolProjectionRef(runID string, toolName string, callIndex int) string {
	return temporalProjectionRef(runID, fmt.Sprintf("sdk-tools/%s/%d", toolName, callIndex))
}
