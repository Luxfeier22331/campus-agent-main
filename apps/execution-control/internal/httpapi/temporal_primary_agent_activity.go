package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if strings.TrimSpace(s.config.AgentRuntimeBaseURL) == "" ||
		strings.TrimSpace(s.config.AgentRuntimeSharedSecret) == "" {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_not_configured",
			fmt.Errorf("agent runtime base URL and shared secret are required"),
		)
	}
	startedAt := time.Now().UTC()
	agentResultRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "primary_agent",
		Run:           run,
		Status:        "started",
		StepID:        "agent.primary",
		StepKind:      "agent",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: agentResultRef,
		Payload: map[string]any{
			"memory_projection_refs": append([]string{}, input.MemoryProjectionRefs...),
			"requested_capability":   input.RequestedCapability,
			"visible_capabilities":   append([]string{}, input.VisibleCapabilities...),
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	output, err := s.callAgentRuntime(ctx, run, input)
	if err != nil {
		return s.failPrimaryAgentActivity(ctx, run, "agent_runtime_request_failed", err)
	}
	if strings.TrimSpace(output.Status) != "completed" {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_incomplete",
			fmt.Errorf("agent runtime status is %q", output.Status),
		)
	}
	if strings.TrimSpace(output.FinalOutput) == "" && !primaryAgentOutputIsWorkflowSignal(output) {
		return s.failPrimaryAgentActivity(
			ctx,
			run,
			"agent_runtime_empty_output",
			fmt.Errorf("agent runtime final_output is required"),
		)
	}
	output.RunID = run.RunID
	output.AgentResultRef = agentResultRef
	if output.TerminalReason == "" {
		output.TerminalReason = string(execution.DurableTerminalReasonAnswerCompleted)
	}
	completedAt := time.Now().UTC()
	payload := primaryAgentResultPayload(output)
	if err := s.replaceTemporalAgentMetadata(ctx, run, func(metadata map[string]any) {
		for key, value := range payload {
			metadata[key] = value
		}
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:               1,
		Capability:            "primary_agent",
		Run:                   run,
		Status:                "completed",
		StepID:                "agent.primary",
		StepKind:              "agent",
		TaskQueue:             temporalruntime.ActivityTaskQueueAgent,
		WorkerID:              s.config.TemporalWorkerIdentity,
		StartedAt:             startedAt,
		CompletedAt:           completedAt,
		UpdatedAt:             completedAt,
		ResultKind:            "agent_final_output",
		ProjectionRef:         agentResultRef,
		ProviderResponseID:    output.ProviderResponseID,
		InputTokens:           output.Usage.InputTokens,
		OutputTokens:          output.Usage.OutputTokens,
		CachedInputTokens:     output.Usage.CachedInputTokens,
		EstimatedCostMicroUSD: output.Usage.EstimatedCostMicroUSD,
		Payload:               payload,
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":agent-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeAgentCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"agent_result_ref":     agentResultRef,
			"provider_response_id": output.ProviderResponseID,
			"sdk_trace_ref":        output.SDKTraceRef,
			"selected_tools":       append([]string{}, output.SelectedTools...),
			"terminal_reason":      output.TerminalReason,
		},
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) callAgentRuntime(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	timeout := time.Duration(s.config.AgentRuntimeTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, err := json.Marshal(map[string]any{
		"run_id":                 input.RunID,
		"conversation_id":        input.ConversationID,
		"turn_id":                input.TurnID,
		"trace_id":               input.TraceID,
		"input":                  primaryAgentInputText(run),
		"visible_capabilities":   append([]string{}, input.VisibleCapabilities...),
		"memory_projection_refs": append([]string{}, input.MemoryProjectionRefs...),
	})
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("encode agent runtime request: %w", err)
	}
	url := strings.TrimRight(s.config.AgentRuntimeBaseURL, "/") + "/internal/agent-runs"
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	request.Header.Set("authorization", "Bearer "+s.config.AgentRuntimeSharedSecret)
	request.Header.Set("content-type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	defer response.Body.Close()
	var decoded agentRuntimeResponse
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("decode agent runtime response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("agent runtime returned HTTP %d", response.StatusCode)
	}
	return decoded.toTemporalOutput(), nil
}

type agentRuntimeResponse struct {
	Status             string            `json:"status"`
	RunID              string            `json:"run_id"`
	FinalOutput        string            `json:"final_output"`
	ProviderResponseID string            `json:"provider_response_id"`
	SDKTraceRef        string            `json:"sdk_trace_ref"`
	SelectedTools      []string          `json:"selected_tools"`
	ToolResults        []agentToolResult `json:"tool_results"`
	TerminalReason     string            `json:"terminal_reason"`
	Usage              agentRuntimeUsage `json:"usage"`
}

type agentToolResult struct {
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
	Capability      string         `json:"capability"`
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

func (response agentRuntimeResponse) toTemporalOutput() temporalruntime.ExecutePrimaryAgentActivityOutput {
	toolResults := make([]temporalruntime.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		toolResults = append(toolResults, temporalruntime.AgentToolResult{
			Capability:      result.Capability,
			FailCloseReason: result.FailCloseReason,
			PayloadKind:     result.PayloadKind,
			Result:          result.Result,
			ResultRef:       result.ResultRef,
			Status:          result.Status,
			ToolName:        result.ToolName,
		})
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{
		FinalOutput:        strings.TrimSpace(response.FinalOutput),
		ProviderResponseID: strings.TrimSpace(response.ProviderResponseID),
		RunID:              strings.TrimSpace(response.RunID),
		SDKTraceRef:        strings.TrimSpace(response.SDKTraceRef),
		SelectedTools:      append([]string{}, response.SelectedTools...),
		Status:             strings.TrimSpace(response.Status),
		TerminalReason:     strings.TrimSpace(response.TerminalReason),
		ToolResults:        toolResults,
		Usage: temporalruntime.AgentUsageSummary{
			CachedInputTokens:     response.Usage.CachedInputTokens,
			EstimatedCostMicroUSD: response.Usage.EstimatedCostMicroUSD,
			InputTokens:           response.Usage.InputTokens,
			OutputTokens:          response.Usage.OutputTokens,
		},
	}
}

func (s *Server) failPrimaryAgentActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "agent/primary/result"),
		ResultKind:    "activity_failure",
		StepID:        "agent.primary",
		StepKind:      "agent",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
		},
	}, cause)
	return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
}

func primaryAgentResultPayload(output temporalruntime.ExecutePrimaryAgentActivityOutput) map[string]any {
	toolResults := make([]map[string]any, 0, len(output.ToolResults))
	for _, result := range output.ToolResults {
		toolResults = append(toolResults, map[string]any{
			"capability":        result.Capability,
			"fail_close_reason": result.FailCloseReason,
			"payload_kind":      result.PayloadKind,
			"result":            result.Result,
			"result_ref":        result.ResultRef,
			"status":            result.Status,
			"tool_name":         result.ToolName,
		})
	}
	return map[string]any{
		"agent_result_ref":     output.AgentResultRef,
		"final_output":         output.FinalOutput,
		"provider_response_id": output.ProviderResponseID,
		"sdk_trace_ref":        output.SDKTraceRef,
		"selected_tools":       append([]string{}, output.SelectedTools...),
		"terminal_reason":      output.TerminalReason,
		"tool_results":         toolResults,
		"usage": map[string]any{
			"cached_input_tokens":      output.Usage.CachedInputTokens,
			"estimated_cost_micro_usd": output.Usage.EstimatedCostMicroUSD,
			"input_tokens":             output.Usage.InputTokens,
			"output_tokens":            output.Usage.OutputTokens,
		},
	}
}

func primaryAgentOutputIsWorkflowSignal(output temporalruntime.ExecutePrimaryAgentActivityOutput) bool {
	if strings.TrimSpace(output.TerminalReason) != "tool_selected" {
		return false
	}
	for _, tool := range output.SelectedTools {
		if strings.TrimSpace(tool) == "knowledge_query" {
			return true
		}
	}
	for _, result := range output.ToolResults {
		if strings.TrimSpace(result.ToolName) == "knowledge_query" {
			return true
		}
		if signal, ok := result.Result["workflow_signal"].(string); ok &&
			strings.TrimSpace(signal) == "knowledge_query" {
			return true
		}
	}
	return false
}

func (s *Server) replaceTemporalAgentMetadata(
	ctx context.Context,
	run execution.DurableRun,
	mutate func(map[string]any),
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	agentMetadata := cloneAnyMapFromMetadata(metadata["temporal_agent"])
	mutate(agentMetadata)
	metadata["temporal_agent"] = agentMetadata
	return s.runProjectionStore.ReplaceRunMetadata(ctx, run.RunID, metadata)
}

func primaryAgentInputText(run execution.DurableRun) string {
	executionPayload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	return strings.TrimSpace(stringValue(executionPayload["user_goal"]))
}
