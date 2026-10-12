package operation

import (
	"context"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

func (s *RunProjectionService) ProjectWorkflowAnswerDelta(
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

func (s *RunProjectionService) ProjectWorkflowAnswerCompleted(
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
