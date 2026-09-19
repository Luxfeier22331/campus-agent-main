package execution

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func WorkflowTransportTimeout(deadlineMS int) time.Duration {
	deadlineMS = PositiveOrDefault(deadlineMS, DefaultAgentDeadlineMS)
	graceMS := deadlineMS / 10
	if graceMS < 1 {
		graceMS = 1
	}
	if graceMS > WorkflowTransportGraceMS {
		graceMS = WorkflowTransportGraceMS
	}
	return time.Duration(deadlineMS+graceMS) * time.Millisecond
}

type AgentRuntimeSSEEvent struct {
	Event string
	Data  json.RawMessage
}

func ReadAgentRuntimeSSEEvents(
	body io.Reader,
	handle func(AgentRuntimeSSEEvent) error,
) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 64*1024), execution.MaxAgentOperationPayloadBytes+1024)
	eventName := ""
	dataLines := make([]string, 0, 1)
	dataSize := 0
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
		if err := execution.ValidateOperationPayloadBytes(data); err != nil {
			return err
		}
		if !json.Valid(data) {
			return fmt.Errorf("agent runtime SSE event %q data is not valid JSON", eventName)
		}
		if err := handle(AgentRuntimeSSEEvent{Event: eventName, Data: data}); err != nil {
			return err
		}
		eventName = ""
		dataLines = dataLines[:0]
		dataSize = 0
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
			value := strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
			if len(dataLines) > 0 {
				dataSize++
			}
			dataSize += len(value)
			if dataSize > execution.MaxAgentOperationPayloadBytes {
				return &execution.OperationPayloadTooLargeError{Bytes: dataSize}
			}
			dataLines = append(dataLines, value)
		case strings.HasPrefix(line, ":"):
			continue
		default:
			return fmt.Errorf("agent runtime SSE line is not supported")
		}
	}
	if err := scanner.Err(); err != nil {
		if errors.Is(err, bufio.ErrTooLong) {
			return &execution.OperationPayloadTooLargeError{Bytes: execution.MaxAgentOperationPayloadBytes + 1}
		}
		return fmt.Errorf("read agent runtime stream: %w", err)
	}
	return flush()
}

func (s *Adapter) ProjectWorkflowAnswerDelta(
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
		_, err := s.RunProjectionStore.StartRunAnswerStream(ctx, execution.RunAnswerStreamStartRequest{
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
	latest, err := s.RunProjectionStore.GetRun(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if latest.Status != execution.DurableRunStatusStreaming {
		return fmt.Errorf("request %s status %s cannot project answer delta", run.RequestID, latest.Status)
	}
	_, err = s.RunProjectionStore.AppendRunEvent(ctx, deltaEvent)
	return err
}

func (s *Adapter) ProjectWorkflowAnswerCompleted(
	ctx context.Context,
	run execution.DurableRun,
	messageID string,
) error {
	return s.AppendTemporalRunEvent(ctx, execution.DurableRunEvent{
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

func AgentRuntimeFailureFromResponse(statusCode int, response AgentRuntimeResponse) error {
	return AgentRuntimeHTTPError{
		StatusCode: statusCode,
		HTTPStatus: response.Error.HTTPStatus,
		Code:       strings.TrimSpace(response.Error.Code),
		Reason:     response.Error.Reason, Citation: response.Error.Citation,
		Detail:         strings.TrimSpace(response.Error.Detail),
		InvocationID:   strings.TrimSpace(response.Error.InvocationID),
		Operation:      strings.TrimSpace(response.Error.Operation),
		RuntimeRelease: strings.TrimSpace(response.RuntimeRelease),
	}
}

func WorkflowRuntimeFailureKind(cause error) string {
	var sizeError *execution.OperationPayloadTooLargeError
	if errors.As(cause, &sizeError) {
		return "workflow_operation_payload_too_large"
	}
	var requestBuildError AgentRuntimeRequestBuildError
	if errors.As(cause, &requestBuildError) {
		return "agent_runtime_request_failed"
	}
	var runtimeError AgentRuntimeHTTPError
	if errors.As(cause, &runtimeError) {
		if runtimeError.StatusCode == http.StatusUnauthorized {
			return "agent_runtime_unauthorized"
		}
		switch strings.TrimSpace(runtimeError.Code) {
		case "workflow_operation_payload_too_large", "invalid_request",
			"context_budget_exceeded",
			"agent_deadline_exceeded",
			"max_turns_exceeded",
			"retrieval_budget_exhausted",
			"answer_synthesis_failed",
			"materials_insufficient",
			"provider_rate_limited",
			"provider_http_failed",
			"provider_connection_failed",
			"provider_timeout",
			"provider_unavailable",
			"tool_execution_failed",
			"tool_contract_mismatch",
			"citation_validation_failed",
			"run_failed":
			return strings.TrimSpace(runtimeError.Code)
		}
		return "agent_runtime_request_failed"
	}
	var applicationError AgentRuntimeApplicationError
	if errors.As(cause, &applicationError) {
		switch strings.TrimSpace(applicationError.Code) {
		case "retrieval_budget_exhausted":
			return "retrieval_budget_exhausted"
		case "workflow_operation_payload_too_large", "invalid_request",
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
			"citation_validation_failed",
			"run_failed":
			return strings.TrimSpace(applicationError.Code)
		}
		return "agent_runtime_request_failed"
	}
	if AgentRuntimeErrorIsTimeout(cause) {
		return "agent_runtime_timeout"
	}
	return "workflow_attempt_uncertain"
}

type AgentRuntimeRequestBuildError struct {
	Cause error
}

func (err AgentRuntimeRequestBuildError) Error() string {
	return "agent runtime request could not be created"
}

func (err AgentRuntimeRequestBuildError) Unwrap() error {
	return err.Cause
}

func AgentRuntimeErrorIsTimeout(cause error) bool {
	if errors.Is(cause, context.DeadlineExceeded) {
		return true
	}
	var netErr interface{ Timeout() bool }
	return errors.As(cause, &netErr) && netErr.Timeout()
}
