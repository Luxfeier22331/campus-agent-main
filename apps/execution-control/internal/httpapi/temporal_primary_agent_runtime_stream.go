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
	conversationContext map[string]any,
	limits primaryAgentRuntimeLimits,
	activityAttempt int,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	payload := primaryAgentRuntimeRequestPayload(
		run,
		input,
		inputText,
		conversationContext,
		limits,
		activityAttempt,
	)
	body, err := json.Marshal(payload)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, fmt.Errorf("encode agent runtime request: %w", err)
	}
	return s.callAgentRuntimeRequest(ctx, run, input.TraceParent, body, limits.AgentDeadlineMS)
}

func primaryAgentRuntimeRequestPayload(
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
	inputText string,
	conversationContext map[string]any,
	limits primaryAgentRuntimeLimits,
	activityAttempt int,
) map[string]any {
	payload := map[string]any{
		"activity_attempt":             activityAttempt,
		"user_id":                      run.OwnerUserID,
		"request_id":                   run.RequestID,
		"conversation_id":              run.ConversationID,
		"input":                        strings.TrimSpace(inputText),
		"visible_tool_names":           append([]string{}, input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames...),
		"limits":                       primaryAgentRuntimeLimitsPayload(limits),
		"expected_model_target_sha256": input.AdmissionSnapshot.PrimaryAgentTargetSHA256,
	}
	if expected := toolContractFingerprintSnapshotMap(input.AdmissionSnapshot.ToolContractFingerprint); expected != nil {
		payload["expected_tool_contract_fingerprint"] = expected
	}
	if len(conversationContext) > 0 {
		payload["conversation_context"] = conversationContext
	}
	return payload
}

func (s *Server) callAgentRuntimeRequest(
	ctx context.Context,
	run execution.DurableRun,
	traceParent string,
	body []byte,
	deadlineMS int,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	timeout := primaryAgentTransportTimeout(deadlineMS)
	traceContext := telemetry.ExtractTraceParent(ctx, traceParent)
	requestCtx, cancel := context.WithTimeout(traceContext, timeout)
	defer cancel()
	url := strings.TrimRight(s.config.AgentRuntimeBaseURL, "/") + "/internal/agent-requests/stream"
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, agentRuntimeRequestBuildError{cause: err}
	}
	request.Header.Set("authorization", "Bearer "+s.config.AgentRuntimeSharedSecret)
	request.Header.Set("content-type", "application/json")
	for key, value := range telemetry.InjectExecutionTraceHeaders(requestCtx, run.RequestID) {
		request.Header.Set(key, value)
	}
	response, err := noRedirectHTTPClient(http.DefaultClient).Do(request)
	if err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		if response.StatusCode == http.StatusUnauthorized {
			return temporalruntime.ExecutePrimaryAgentActivityOutput{}, agentRuntimeHTTPError{
				StatusCode: response.StatusCode,
				Code:       "unauthorized",
			}
		}
		var decoded agentRuntimeResponse
		_ = json.NewDecoder(response.Body).Decode(&decoded)
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, agentRuntimeFailureFromResponse(
			response.StatusCode,
			decoded,
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
	messageID := run.RequestID + ":answer"
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
		if err := s.projectPrimaryAgentAnswerDelta(
			ctx,
			run,
			messageID,
			persistedChunkIndex,
			pendingDelta.String(),
		); err != nil {
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
			pendingDelta.WriteString(delta.Delta)
			if persistedChunkIndex == 0 || pendingDelta.Len() >= deltaFlushBytes {
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
			var runtimeErr struct {
				agentRuntimeError
				RuntimeRelease string `json:"runtime_release"`
			}
			if err := json.Unmarshal(event.Data, &runtimeErr); err != nil {
				return fmt.Errorf("decode agent runtime error event: %w", err)
			}
			streamError = agentRuntimeApplicationError{
				Code:           strings.TrimSpace(runtimeErr.Code),
				Detail:         strings.TrimSpace(runtimeErr.Detail),
				HTTPStatus:     runtimeErr.HTTPStatus,
				InvocationID:   strings.TrimSpace(runtimeErr.InvocationID),
				Operation:      strings.TrimSpace(runtimeErr.Operation),
				RuntimeRelease: strings.TrimSpace(runtimeErr.RuntimeRelease),
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
			if persistedChunkIndex > 0 {
				if err := s.projectPrimaryAgentAnswerCompleted(ctx, run, messageID); err != nil {
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
	Delta         string `json:"delta"`
}

// agentRuntimeStreamState tracks the lifecycle of the upstream SSE stream.
type agentRuntimeStreamState struct {
	terminalEvent string
}

func (state agentRuntimeStreamState) validateDelta(delta agentRuntimeAnswerDelta) error {
	if strings.TrimSpace(delta.SchemaVersion) != "agent_runtime_answer_delta.v3" {
		return fmt.Errorf("agent runtime answer_delta schema_version drift")
	}
	if delta.Delta == "" {
		return fmt.Errorf("agent runtime answer_delta delta is required")
	}
	return nil
}

func (state agentRuntimeStreamState) validateCompleted(
	run execution.DurableRun,
	response agentRuntimeResponse,
) error {
	if strings.TrimSpace(response.RequestID) == "" {
		return fmt.Errorf("agent runtime completed request_id is required")
	}
	if strings.TrimSpace(response.RequestID) != strings.TrimSpace(run.RequestID) {
		return fmt.Errorf(
			"agent runtime completed request_id %q does not match request %q",
			strings.TrimSpace(response.RequestID),
			strings.TrimSpace(run.RequestID),
		)
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
	chunkIndex int,
	deltaText string,
) error {
	if chunkIndex <= 0 {
		return fmt.Errorf("run answer_delta chunk_index is required")
	}
	if deltaText == "" {
		return fmt.Errorf("agent runtime answer_delta delta is required")
	}
	now := time.Now().UTC()
	deltaEvent := execution.DurableRunEvent{
		EventID:              fmt.Sprintf("%s:answer-delta:%d", run.RequestID, chunkIndex),
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunAnswerDelta,
		OccurredAt:           now,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-answer-event-v2",
		Payload: map[string]any{
			"chunk_index": chunkIndex,
			"delta":       deltaText,
			"message_id":  messageID,
			"request_id":  run.RequestID,
		},
	}
	if chunkIndex == 1 {
		_, err := s.runProjectionStore.StartRunAnswerStream(ctx, execution.RunAnswerStreamStartRequest{
			RequestID: run.RequestID,
			Now:       now,
			AnswerStartedEvent: execution.DurableRunEvent{
				EventID:              run.RequestID + ":answer-started",
				RequestID:            run.RequestID,
				ConversationID:       run.ConversationID,
				EventType:            execution.DurableRunEventTypeRunAnswerStarted,
				OccurredAt:           now,
				Visibility:           execution.DurableRunEventVisibilityBrowser,
				PayloadSchemaVersion: "run-answer-event-v2",
				Payload: map[string]any{
					"message_id": messageID,
					"request_id": run.RequestID,
					"status":     string(execution.DurableRunStatusStreaming),
				},
			},
			FirstDeltaEvent: deltaEvent,
		})
		return err
	}
	latest, err := s.runProjectionStore.GetRun(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if latest.Status != execution.DurableRunStatusStreaming {
		return fmt.Errorf("request %s status %s cannot project answer delta", run.RequestID, latest.Status)
	}
	_, err = s.runProjectionStore.AppendRunEvent(ctx, deltaEvent)
	return err
}

func (s *Server) projectPrimaryAgentAnswerCompleted(
	ctx context.Context,
	run execution.DurableRun,
	messageID string,
) error {
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":answer-completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunAnswerCompleted,
		OccurredAt:           time.Now().UTC(),
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-answer-event-v1",
		Payload: map[string]any{
			"message_id": messageID,
			"request_id": run.RequestID,
		},
	})
}

func agentRuntimeFailureFromResponse(
	statusCode int,
	response agentRuntimeResponse,
) error {
	return agentRuntimeHTTPError{
		StatusCode:     statusCode,
		Code:           strings.TrimSpace(response.Error.Code),
		Detail:         strings.TrimSpace(response.Error.Detail),
		InvocationID:   strings.TrimSpace(response.Error.InvocationID),
		Operation:      strings.TrimSpace(response.Error.Operation),
		RuntimeRelease: strings.TrimSpace(response.RuntimeRelease),
	}
}

func primaryAgentRuntimeFailureKind(cause error) string {
	var requestBuildError agentRuntimeRequestBuildError
	if errors.As(cause, &requestBuildError) {
		return "agent_runtime_request_failed"
	}
	var runtimeError agentRuntimeHTTPError
	if errors.As(cause, &runtimeError) {
		if runtimeError.StatusCode == http.StatusUnauthorized {
			return "agent_runtime_unauthorized"
		}
		switch strings.TrimSpace(runtimeError.Code) {
		case "invalid_request",
			"context_budget_exceeded",
			"agent_deadline_exceeded",
			"max_turns_exceeded",
			"provider_rate_limited",
			"provider_http_failed",
			"provider_connection_failed",
			"provider_timeout",
			"provider_unavailable",
			"tool_execution_failed",
			"tool_contract_mismatch",
			"run_failed":
			return strings.TrimSpace(runtimeError.Code)
		}
		return "agent_runtime_request_failed"
	}
	var applicationError agentRuntimeApplicationError
	if errors.As(cause, &applicationError) {
		switch strings.TrimSpace(applicationError.Code) {
		case "invalid_request",
			"context_budget_exceeded",
			"agent_deadline_exceeded",
			"max_turns_exceeded",
			"provider_rate_limited",
			"provider_http_failed",
			"provider_connection_failed",
			"provider_timeout",
			"provider_unavailable",
			"tool_execution_failed",
			"tool_contract_mismatch",
			"run_failed":
			return strings.TrimSpace(applicationError.Code)
		}
		return "agent_runtime_request_failed"
	}
	if agentRuntimeErrorIsTimeout(cause) {
		return "agent_attempt_uncertain"
	}
	return "agent_attempt_uncertain"
}

type agentRuntimeRequestBuildError struct {
	cause error
}

func (err agentRuntimeRequestBuildError) Error() string {
	return "agent runtime request could not be created"
}

func (err agentRuntimeRequestBuildError) Unwrap() error {
	return err.cause
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
			ArgumentsJSON: cloneAnyMapFromMetadata(result.ArgumentsJSON),
			DurationMS:    result.DurationMS,
			Failure:       result.Failure,
			InvocationID:  strings.TrimSpace(result.InvocationID),
			Result:        result.Result,
			Status:        result.Status,
			ToolName:      result.ToolName,
		})
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{
		ContextUsage:            cloneAnyMapFromMetadata(response.ContextUsage),
		FinalOutput:             response.FinalOutput,
		ModelName:               strings.TrimSpace(response.ModelName),
		ModelProvider:           strings.TrimSpace(response.ModelProvider),
		PromptTrace:             cloneAnyMapFromMetadata(response.PromptTrace),
		ProviderResponseID:      strings.TrimSpace(response.ProviderResponseID),
		RequestID:               strings.TrimSpace(response.RequestID),
		StageTiming:             cloneAnyMapFromMetadata(response.StageTiming),
		Status:                  strings.TrimSpace(response.Status),
		TerminalReason:          strings.TrimSpace(response.TerminalReason),
		ToolResults:             toolResults,
		ToolContractFingerprint: cloneAnyMapFromMetadata(response.ToolContractFingerprint),
		RuntimeRelease:          strings.TrimSpace(response.RuntimeRelease),
		Usage: temporalruntime.AgentUsageSummary{
			ModelRequestCount: response.Usage.ModelRequestCount,
			CachedInputTokens: response.Usage.CachedInputTokens,
			InputTokens:       response.Usage.InputTokens,
			OutputTokens:      response.Usage.OutputTokens,
			UsageObserved:     response.Usage.UsageObserved,
		},
	}
}
