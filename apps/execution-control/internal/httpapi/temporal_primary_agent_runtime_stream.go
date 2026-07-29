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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) callAgentRuntime(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	inputText string,
	providerConfig providerConfigSnapshot,
	finalModelContext map[string]any,
	grounding groundingContext,
	limits primaryAgentRuntimeLimits,
	activityAttempt int,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	payload := primaryAgentRuntimeRequestPayload(
		run,
		input,
		inputText,
		providerConfig,
		finalModelContext,
		grounding,
		limits,
		activityAttempt,
	)
	body, err := json.Marshal(payload)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("encode agent runtime request: %w", err)
	}
	return s.callAgentRuntimeRequest(ctx, run, body, limits.AgentDeadlineMS)
}

func primaryAgentRuntimeRequestPayload(
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	inputText string,
	providerConfig providerConfigSnapshot,
	finalModelContext map[string]any,
	grounding groundingContext,
	limits primaryAgentRuntimeLimits,
	activityAttempt int,
) map[string]any {
	payload := map[string]any{
		"activity_attempt":        activityAttempt,
		"allow_ungrounded_answer": input.AdmissionSnapshot.ExecutionStrategy.AllowUngroundedAnswer,
		"user_id":                 run.OwnerUserID,
		"run_id":                  input.RunID,
		"request_id":              run.RequestID,
		"conversation_id":         input.ConversationID,
		"turn_id":                 input.TurnID,
		"trace_id":                input.TraceID,
		"input":                   strings.TrimSpace(inputText),
		"visible_tool_names":      append([]string{}, input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames...),
		"limits":                  primaryAgentRuntimeLimitsPayload(limits),
		"provider_config":         primaryAgentProviderConfigPayload(providerConfig),
		"grounding_context":       grounding,
	}
	if expected := toolRuntimeFingerprintSnapshotMap(input.AdmissionSnapshot.ToolRuntimeFingerprint); expected != nil {
		payload["expected_tool_runtime_fingerprint"] = expected
	}
	if len(finalModelContext) > 0 {
		payload["final_model_context"] = finalModelContext
	}
	return payload
}

func (s *Server) callAgentRuntimeRequest(
	ctx context.Context,
	run execution.DurableRun,
	body []byte,
	deadlineMS int,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	timeout := primaryAgentTransportTimeout(deadlineMS)
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	url := strings.TrimRight(s.config.AgentRuntimeBaseURL, "/") + "/internal/agent-runs/stream"
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	request.Header.Set("authorization", "Bearer "+s.config.AgentRuntimeSharedSecret)
	request.Header.Set("content-type", "application/json")
	for key, value := range telemetry.InjectExecutionTraceHeaders(requestCtx, run.RequestID, run.TraceID) {
		request.Header.Set(key, value)
	}
	response, err := noRedirectHTTPClient(http.DefaultClient).Do(request)
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

func primaryAgentTransportTimeout(deadlineMS int) time.Duration {
	deadlineMS = positiveOrDefault(deadlineMS, defaultAgentDeadlineMS)
	graceMS := deadlineMS / 10
	if graceMS < 1 {
		graceMS = 1
	}
	if graceMS > primaryAgentTransportGraceMS {
		graceMS = primaryAgentTransportGraceMS
	}
	return time.Duration(deadlineMS+graceMS) * time.Millisecond
}

func primaryAgentProviderConfigPayload(config providerConfigSnapshot) map[string]any {
	return map[string]any{
		"provider":  config.Provider,
		"transport": config.Transport,
		"base_url":  config.BaseURL,
		"model":     config.Model,
		"api_key":   config.APIKey,
	}
}

func (s *Server) consumeAgentRuntimeStream(
	ctx context.Context,
	run execution.DurableRun,
	body io.Reader,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	const (
		streamEventQueueCapacity = 64
		deltaFlushBytes          = 1024
		deltaFlushInterval       = 50 * time.Millisecond
	)
	messageID := run.RunID + ":answer"
	var completed *agentRuntimeResponse
	state := agentRuntimeStreamState{}
	var streamError error
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	events := make(chan agentRuntimeSSEEvent, streamEventQueueCapacity)
	readDone := make(chan error, 1)
	go func() {
		err := readAgentRuntimeSSEEvents(body, func(event agentRuntimeSSEEvent) error {
			select {
			case events <- event:
				return nil
			case <-streamCtx.Done():
				return streamCtx.Err()
			}
		})
		close(events)
		readDone <- err
	}()

	var pendingDelta strings.Builder
	persistedChunkIndex := 0
	var flushTimer *time.Timer
	var flushTimerC <-chan time.Time
	stopFlushTimer := func() {
		if flushTimer == nil {
			return
		}
		if !flushTimer.Stop() {
			select {
			case <-flushTimer.C:
			default:
			}
		}
		flushTimerC = nil
	}
	startFlushTimer := func() {
		if flushTimer == nil {
			flushTimer = time.NewTimer(deltaFlushInterval)
		} else {
			flushTimer.Reset(deltaFlushInterval)
		}
		flushTimerC = flushTimer.C
	}
	flushPendingDelta := func() error {
		if pendingDelta.Len() == 0 {
			return nil
		}
		stopFlushTimer()
		persistedChunkIndex++
		delta := agentRuntimeAnswerDelta{
			SchemaVersion: "agent_runtime_answer_delta.v2",
			ChunkIndex:    persistedChunkIndex,
			Delta:         pendingDelta.String(),
		}
		if err := s.projectPrimaryAgentAnswerDelta(ctx, run, messageID, delta); err != nil {
			return err
		}
		pendingDelta.Reset()
		return nil
	}
	processEvent := func(event agentRuntimeSSEEvent) error {
		if state.terminalEvent != "" {
			return fmt.Errorf(
				"agent runtime stream event %q appears after terminal event %q",
				event.Event,
				state.terminalEvent,
			)
		}
		switch event.Event {
		case "answer_delta":
			var delta agentRuntimeAnswerDelta
			if err := json.Unmarshal(event.Data, &delta); err != nil {
				return fmt.Errorf("decode agent runtime answer_delta event: %w", err)
			}
			if err := state.validateDelta(delta); err != nil {
				return err
			}
			state.recordDelta(delta)
			pendingDelta.WriteString(delta.Delta)
			if state.lastChunkIndex == 1 || pendingDelta.Len() >= deltaFlushBytes {
				return flushPendingDelta()
			}
			if flushTimerC == nil {
				startFlushTimer()
			}
		case "completed":
			if err := flushPendingDelta(); err != nil {
				return err
			}
			var decoded agentRuntimeResponse
			if err := json.Unmarshal(event.Data, &decoded); err != nil {
				return fmt.Errorf("decode agent runtime completed event: %w", err)
			}
			if err := state.validateCompleted(run, decoded); err != nil {
				return err
			}
			completed = &decoded
			state.terminalEvent = "completed"
		case "error":
			if err := flushPendingDelta(); err != nil {
				return err
			}
			var runtimeErr agentRuntimeError
			if err := json.Unmarshal(event.Data, &runtimeErr); err != nil {
				return fmt.Errorf("decode agent runtime error event: %w", err)
			}
			streamError = agentRuntimeHTTPError{
				StatusCode: http.StatusBadGateway,
				Code:       strings.TrimSpace(runtimeErr.Code),
				Message:    strings.TrimSpace(runtimeErr.Message),
			}
			state.terminalEvent = "error"
		default:
			return fmt.Errorf("agent runtime stream event %q is not supported", event.Event)
		}
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			stopFlushTimer()
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, ctx.Err()
		case <-flushTimerC:
			flushTimerC = nil
			if err := flushPendingDelta(); err != nil {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
			}
		case event, ok := <-events:
			if ok {
				if err := processEvent(event); err != nil {
					return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
				}
				continue
			}
			stopFlushTimer()
			if err := flushPendingDelta(); err != nil {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
			}
			if err := <-readDone; err != nil {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
			}
			if streamError != nil {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, streamError
			}
			if completed == nil {
				return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("agent runtime stream completed without completed event")
			}
			if state.accumulatedText != "" {
				if err := s.projectPrimaryAgentAnswerCompleted(ctx, run, messageID, state.accumulatedText); err != nil {
					return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
				}
			}
			return completed.toTemporalOutput(), nil
		}
	}
}

type agentRuntimeSSEEvent struct {
	Event string
	Data  json.RawMessage
}

type agentRuntimeAnswerDelta struct {
	SchemaVersion string `json:"schema_version"`
	ChunkIndex    int    `json:"chunk_index"`
	Delta         string `json:"delta"`
}

// agentRuntimeStreamState tracks the cross-event invariants that cannot be
// checked from one SSE frame in isolation.
type agentRuntimeStreamState struct {
	accumulatedText string
	lastChunkIndex  int
	terminalEvent   string
}

func (state agentRuntimeStreamState) validateDelta(delta agentRuntimeAnswerDelta) error {
	if strings.TrimSpace(delta.SchemaVersion) != "agent_runtime_answer_delta.v2" {
		return fmt.Errorf("agent runtime answer_delta schema_version drift")
	}
	if delta.Delta == "" {
		return fmt.Errorf("agent runtime answer_delta delta is required")
	}
	if delta.ChunkIndex <= 0 {
		return fmt.Errorf("agent runtime answer_delta chunk_index is required")
	}
	if state.lastChunkIndex == 0 {
		if delta.ChunkIndex != 1 {
			return fmt.Errorf(
				"agent runtime answer_delta chunk_index = %d, want first chunk index 1",
				delta.ChunkIndex,
			)
		}
		return nil
	}
	wantChunkIndex := state.lastChunkIndex + 1
	if delta.ChunkIndex != wantChunkIndex {
		return fmt.Errorf(
			"agent runtime answer_delta chunk_index = %d, want %d",
			delta.ChunkIndex,
			wantChunkIndex,
		)
	}
	return nil
}

func (state *agentRuntimeStreamState) recordDelta(delta agentRuntimeAnswerDelta) {
	state.lastChunkIndex = delta.ChunkIndex
	state.accumulatedText += delta.Delta
}

func (state agentRuntimeStreamState) validateCompleted(
	run execution.DurableRun,
	response agentRuntimeResponse,
) error {
	if strings.TrimSpace(response.RunID) == "" {
		return fmt.Errorf("agent runtime completed run_id is required")
	}
	if strings.TrimSpace(response.RunID) != strings.TrimSpace(run.RunID) {
		return fmt.Errorf(
			"agent runtime completed run_id %q does not match run %q",
			strings.TrimSpace(response.RunID),
			strings.TrimSpace(run.RunID),
		)
	}
	if state.lastChunkIndex > 0 && response.FinalOutput != state.accumulatedText {
		return fmt.Errorf("agent runtime completed final_output does not match answer_delta accumulated_text")
	}
	return nil
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
	if strings.TrimSpace(delta.SchemaVersion) != "agent_runtime_answer_delta.v2" {
		return fmt.Errorf("agent runtime answer_delta schema_version drift")
	}
	if delta.Delta == "" {
		return fmt.Errorf("agent runtime answer_delta delta is required")
	}
	if delta.ChunkIndex <= 0 {
		return fmt.Errorf("agent runtime answer_delta chunk_index is required")
	}
	now := time.Now().UTC()
	deltaEvent := execution.DurableRunEvent{
		EventID:              fmt.Sprintf("%s:answer-delta:%d", run.RunID, delta.ChunkIndex),
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunAnswerDelta,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-answer-event-v2",
		Payload: map[string]any{
			"chunk_index": delta.ChunkIndex,
			"delta":       delta.Delta,
			"message_id":  messageID,
			"request_id":  run.RequestID,
			"trace_id":    run.TraceID,
		},
	}
	if delta.ChunkIndex == 1 {
		_, err := s.runProjectionStore.StartRunAnswerStream(ctx, execution.RunAnswerStreamStartRequest{
			RunID: run.RunID,
			Now:   now,
			AnswerStartedEvent: execution.DurableRunEvent{
				EventID:              run.RunID + ":answer-started",
				RunID:                run.RunID,
				ConversationID:       run.ConversationID,
				EventType:            execution.DurableRunEventTypeRunAnswerStarted,
				OccurredAt:           now,
				Visibility:           execution.DurableRunEventVisibilityBrowser,
				PayloadSchemaVersion: "run-answer-event-v2",
				Payload: map[string]any{
					"message_id": messageID,
					"request_id": run.RequestID,
					"status":     string(execution.DurableRunStatusStreaming),
					"trace_id":   run.TraceID,
				},
			},
			FirstDeltaEvent: deltaEvent,
		})
		return err
	}
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if latest.Status != execution.DurableRunStatusStreaming {
		return fmt.Errorf("run %s status %s cannot project answer delta", run.RunID, latest.Status)
	}
	_, err = s.runProjectionStore.AppendRunEvent(ctx, deltaEvent)
	return err
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
	var runtimeError agentRuntimeHTTPError
	if errors.As(cause, &runtimeError) {
		switch strings.TrimSpace(runtimeError.Code) {
		case "invalid_request",
			"context_budget_exceeded",
			"agent_deadline_exceeded",
			"max_turns_exceeded",
			"provider_unavailable",
			"tool_execution_failed",
			"run_failed":
			return strings.TrimSpace(runtimeError.Code)
		}
	}
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
			DurationMS:      result.DurationMS,
			FailCloseReason: result.FailCloseReason,
			PayloadKind:     result.PayloadKind,
			Result:          result.Result,
			ResultRef:       result.ResultRef,
			Status:          result.Status,
			ToolName:        result.ToolName,
		})
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{
		FinalOutput:            strings.TrimSpace(response.FinalOutput),
		ModelName:              strings.TrimSpace(response.ModelName),
		ModelProvider:          strings.TrimSpace(response.ModelProvider),
		PromptTrace:            cloneAnyMapFromMetadata(response.PromptTrace),
		ProviderResponseID:     strings.TrimSpace(response.ProviderResponseID),
		RunID:                  strings.TrimSpace(response.RunID),
		StageTiming:            cloneAnyMapFromMetadata(response.StageTiming),
		Status:                 strings.TrimSpace(response.Status),
		TerminalEnvelope:       cloneAnyMapFromMetadata(response.TerminalEnvelope),
		TerminalReason:         strings.TrimSpace(response.TerminalReason),
		ToolResults:            toolResults,
		ToolRuntimeFingerprint: cloneAnyMapFromMetadata(response.ToolRuntimeFingerprint),
		Usage: temporalruntime.AgentUsageSummary{
			ModelRequestCount: response.Usage.ModelRequestCount,
			CachedInputTokens: response.Usage.CachedInputTokens,
			InputTokens:       response.Usage.InputTokens,
			OutputTokens:      response.Usage.OutputTokens,
			UsageObserved:     response.Usage.UsageObserved,
		},
	}
}
