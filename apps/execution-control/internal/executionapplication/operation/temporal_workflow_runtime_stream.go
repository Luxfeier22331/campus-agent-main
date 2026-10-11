package operation

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

func (s *OperationService) ProjectWorkflowAnswerDelta(
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
		_, err := s.StateWriter.StartRunAnswerStream(ctx, execution.RunAnswerStreamStartRequest{
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

func (s *OperationService) ProjectWorkflowAnswerCompleted(
	ctx context.Context,
	run execution.DurableRun,
	messageID string,
) error {
	return s.AppendRunEvent(ctx, execution.DurableRunEvent{
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

func WorkflowRuntimeFailureKind(cause error) string {
	var sizeError *execution.OperationPayloadTooLargeError
	if errors.As(cause, &sizeError) {
		return "workflow_operation_payload_too_large"
	}
	var requestBuildError AgentRuntimeRequestBuildError
	if errors.As(cause, &requestBuildError) {
		return "agent_runtime_request_failed"
	}
	var failure executionapplication.AgentRuntimeFailure
	if errors.As(cause, &failure) {
		if failure.Kind != "" {
			return failure.Kind
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
