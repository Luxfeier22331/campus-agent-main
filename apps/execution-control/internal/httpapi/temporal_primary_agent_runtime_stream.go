package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) callAgentRuntime(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	providerConfig providerConfigSnapshot,
	debugTraceConfig llmDebugTraceConfig,
	finalModelContext map[string]any,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	timeout := time.Duration(s.config.AgentRuntimeTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	payload := map[string]any{
		"run_id":                 input.RunID,
		"conversation_id":        input.ConversationID,
		"turn_id":                input.TurnID,
		"trace_id":               input.TraceID,
		"input":                  primaryAgentInputText(run),
		"visible_tool_names":     append([]string{}, input.VisibleToolNames...),
		"memory_projection_refs": append([]string{}, input.MemoryProjectionRefs...),
		"provider_config":        providerConfig,
		"debug_trace_config":     debugTraceConfig,
	}
	if len(finalModelContext) > 0 {
		payload["final_model_context"] = finalModelContext
	}
	if memoryContext := temporalMemoryContextPayload(input.MemoryContext); memoryContext != nil {
		payload["memory_context"] = memoryContext
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("encode agent runtime request: %w", err)
	}
	url := strings.TrimRight(s.config.AgentRuntimeBaseURL, "/") + "/internal/agent-runs/stream"
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
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var decoded agentRuntimeResponse
		if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("decode agent runtime response: %w", err)
		}
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, agentRuntimeFailureFromResponse(
			response.StatusCode,
			decoded.Error,
		)
	}
	return s.consumeAgentRuntimeStream(ctx, run, response.Body)
}

func (s *Server) consumeAgentRuntimeStream(
	ctx context.Context,
	run execution.DurableRun,
	body io.Reader,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	messageID := run.RunID + ":answer"
	var completed *agentRuntimeResponse
	var accumulatedText string
	if err := readAgentRuntimeSSEEvents(body, func(event agentRuntimeSSEEvent) error {
		switch event.Event {
		case "answer_delta":
			var delta agentRuntimeAnswerDelta
			if err := json.Unmarshal(event.Data, &delta); err != nil {
				return fmt.Errorf("decode agent runtime answer_delta event: %w", err)
			}
			if err := s.projectPrimaryAgentAnswerDelta(ctx, run, messageID, delta); err != nil {
				return err
			}
			accumulatedText = delta.AccumulatedText
		case "completed":
			var decoded agentRuntimeResponse
			if err := json.Unmarshal(event.Data, &decoded); err != nil {
				return fmt.Errorf("decode agent runtime completed event: %w", err)
			}
			completed = &decoded
		case "error":
			var runtimeErr agentRuntimeError
			if err := json.Unmarshal(event.Data, &runtimeErr); err != nil {
				return fmt.Errorf("decode agent runtime error event: %w", err)
			}
			return agentRuntimeHTTPError{
				StatusCode: http.StatusBadGateway,
				Code:       strings.TrimSpace(runtimeErr.Code),
				Message:    strings.TrimSpace(runtimeErr.Message),
			}
		default:
			return fmt.Errorf("agent runtime stream event %q is not supported", event.Event)
		}
		return nil
	}); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	if completed == nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("agent runtime stream completed without completed event")
	}
	if accumulatedText != "" {
		if err := s.projectPrimaryAgentAnswerCompleted(ctx, run, messageID, accumulatedText); err != nil {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
		}
	}
	return completed.toTemporalOutput(), nil
}

type agentRuntimeSSEEvent struct {
	Event string
	Data  json.RawMessage
}

type agentRuntimeAnswerDelta struct {
	SchemaVersion   string `json:"schema_version"`
	AccumulatedText string `json:"accumulated_text"`
	ChunkIndex      int    `json:"chunk_index"`
	Delta           string `json:"delta"`
}

func readAgentRuntimeSSEEvents(
	body io.Reader,
	handle func(agentRuntimeSSEEvent) error,
) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	eventName := ""
	dataLines := make([]string, 0, 1)
	flush := func() error {
		if eventName == "" && len(dataLines) == 0 {
			return nil
		}
		if eventName == "" {
			return fmt.Errorf("agent runtime SSE event name is required")
		}
		if len(dataLines) == 0 {
			return fmt.Errorf("agent runtime SSE event %q data is required", eventName)
		}
		data := json.RawMessage(strings.Join(dataLines, "\n"))
		if !json.Valid(data) {
			return fmt.Errorf("agent runtime SSE event %q data is not valid JSON", eventName)
		}
		if err := handle(agentRuntimeSSEEvent{Event: eventName, Data: data}); err != nil {
			return err
		}
		eventName = ""
		dataLines = dataLines[:0]
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		case strings.HasPrefix(line, ":"):
			continue
		default:
			return fmt.Errorf("agent runtime SSE line is not supported")
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read agent runtime stream: %w", err)
	}
	if err := flush(); err != nil {
		return err
	}
	return nil
}

func (s *Server) projectPrimaryAgentAnswerDelta(
	ctx context.Context,
	run execution.DurableRun,
	messageID string,
	delta agentRuntimeAnswerDelta,
) error {
	if strings.TrimSpace(delta.SchemaVersion) != "agent_runtime_answer_delta.v1" {
		return fmt.Errorf("agent runtime answer_delta schema_version drift")
	}
	if strings.TrimSpace(delta.Delta) == "" {
		return fmt.Errorf("agent runtime answer_delta delta is required")
	}
	if strings.TrimSpace(delta.AccumulatedText) == "" {
		return fmt.Errorf("agent runtime answer_delta accumulated_text is required")
	}
	if delta.ChunkIndex <= 0 {
		return fmt.Errorf("agent runtime answer_delta chunk_index is required")
	}
	now := time.Now().UTC()
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if latest.Status == execution.DurableRunStatusRunning {
		streaming, err := s.runProjectionStore.TransitionRun(
			ctx,
			run.RunID,
			execution.DurableRunStatusStreaming,
			"",
			now,
		)
		if err != nil {
			return err
		}
		latest = streaming
		if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
			EventID:              run.RunID + ":answer-started",
			RunID:                run.RunID,
			ConversationID:       run.ConversationID,
			EventType:            execution.DurableRunEventTypeRunAnswerStarted,
			OccurredAt:           now,
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			PayloadSchemaVersion: "run-answer-event-v1",
			Payload: map[string]any{
				"message_id": messageID,
				"request_id": run.RequestID,
				"status":     string(execution.DurableRunStatusStreaming),
				"trace_id":   run.TraceID,
			},
		}); err != nil {
			return err
		}
	}
	if latest.Status != execution.DurableRunStatusStreaming {
		return fmt.Errorf("run %s status %s cannot project answer delta", run.RunID, latest.Status)
	}
	eventID := fmt.Sprintf("%s:answer-delta:%d", run.RunID, delta.ChunkIndex)
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              eventID,
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunAnswerDelta,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-answer-event-v1",
		Payload: map[string]any{
			"accumulated_text": delta.AccumulatedText,
			"chunk_index":      delta.ChunkIndex,
			"delta":            delta.Delta,
			"message_id":       messageID,
			"request_id":       run.RequestID,
			"trace_id":         run.TraceID,
		},
	})
}

func (s *Server) projectPrimaryAgentAnswerCompleted(
	ctx context.Context,
	run execution.DurableRun,
	messageID string,
	accumulatedText string,
) error {
	if strings.TrimSpace(accumulatedText) == "" {
		return fmt.Errorf("agent runtime answer_completed accumulated_text is required")
	}
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":answer-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunAnswerCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-answer-event-v1",
		Payload: map[string]any{
			"accumulated_text": accumulatedText,
			"message_id":       messageID,
			"request_id":       run.RequestID,
			"trace_id":         run.TraceID,
		},
	})
}

func agentRuntimeFailureFromResponse(
	statusCode int,
	runtimeError agentRuntimeError,
) error {
	return agentRuntimeHTTPError{
		StatusCode: statusCode,
		Code:       strings.TrimSpace(runtimeError.Code),
		Message:    strings.TrimSpace(runtimeError.Message),
	}
}

func primaryAgentRuntimeFailureKind(cause error) string {
	if agentRuntimeErrorIsTimeout(cause) {
		return "agent_runtime_timeout"
	}
	return "agent_runtime_request_failed"
}

func agentRuntimeErrorIsTimeout(cause error) bool {
	if errors.Is(cause, context.DeadlineExceeded) {
		return true
	}
	var netErr interface{ Timeout() bool }
	if errors.As(cause, &netErr) && netErr.Timeout() {
		return true
	}
	return false
}

func (response agentRuntimeResponse) toTemporalOutput() temporalruntime.ExecutePrimaryAgentActivityOutput {
	toolResults := make([]temporalruntime.AgentToolResult, 0, len(response.ToolResults))
	for _, result := range response.ToolResults {
		toolResults = append(toolResults, temporalruntime.AgentToolResult{
			ArgumentsJSON:   cloneAnyMapFromMetadata(result.ArgumentsJSON),
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
		DebugTraceRefs:     debugTraceRefsToTemporal(response.DebugTraceRefs),
		ModelName:          strings.TrimSpace(response.ModelName),
		ModelProvider:      strings.TrimSpace(response.ModelProvider),
		ProviderResponseID: strings.TrimSpace(response.ProviderResponseID),
		RunID:              strings.TrimSpace(response.RunID),
		SDKTraceRef:        strings.TrimSpace(response.SDKTraceRef),
		SelectedTools:      append([]string{}, response.SelectedTools...),
		StageTiming:        cloneAnyMapFromMetadata(response.StageTiming),
		Status:             strings.TrimSpace(response.Status),
		TerminalEnvelope:   cloneAnyMapFromMetadata(response.TerminalEnvelope),
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

func debugTraceRefsToTemporal(refs []debugTraceRef) []temporalruntime.DebugTraceRef {
	result := make([]temporalruntime.DebugTraceRef, 0, len(refs))
	for _, ref := range refs {
		sink := strings.TrimSpace(ref.Sink)
		traceRef := strings.TrimSpace(ref.TraceRef)
		if sink == "" || traceRef == "" {
			continue
		}
		result = append(result, temporalruntime.DebugTraceRef{
			Sink:     sink,
			TraceID:  strings.TrimSpace(ref.TraceID),
			TraceRef: traceRef,
			URL:      strings.TrimSpace(ref.URL),
		})
	}
	return result
}
