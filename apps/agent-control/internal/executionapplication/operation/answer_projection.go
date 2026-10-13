package operation

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

// ProjectWorkflowAnswerStarted persists lifecycle state independently of delivery.
func (s *RunProjectionService) ProjectWorkflowAnswerStarted(ctx context.Context, run execution.DurableRun, messageID string) error {
	if messageID != run.RequestID+":answer" {
		return executionfailure.SanitizedError("invalid_answer_identity", nil, true)
	}
	now := time.Now().UTC()
	_, err := s.StateWriter.StartRunAnswerStream(ctx, execution.RunAnswerStreamStartRequest{
		RequestID: run.RequestID, Now: now,
		AnswerStartedEvent: execution.DurableRunEvent{
			EventID: run.RequestID + ":answer-started", RequestID: run.RequestID, ConversationID: run.ConversationID,
			EventType: execution.DurableRunEventTypeRunAnswerStarted, OccurredAt: now,
			Visibility: execution.DurableRunEventVisibilityBrowser, PayloadSchemaVersion: "run-answer-event-v2",
			Payload: map[string]any{"message_id": messageID, "request_id": run.RequestID, "status": "streaming"},
		},
	})
	return err
}

func (s *RunProjectionService) ProjectWorkflowAnswerDelta(ctx context.Context, run execution.DurableRun, messageID string, answerIndex int, deltaText string) error {
	if answerIndex <= 0 || deltaText == "" || utf8.RuneCountInString(deltaText) > answerstream.MaxChunkRunes {
		return executionfailure.SanitizedError("invalid_answer_delta", nil, true)
	}
	if messageID != run.RequestID+":answer" {
		return executionfailure.SanitizedError("invalid_answer_identity", nil, true)
	}
	if run.Status != execution.DurableRunStatusStreaming {
		return executionfailure.SanitizedError("invalid_answer_state", nil, true)
	}
	if s.Answers == nil {
		return executionfailure.SanitizedError("answer_transport_not_configured", nil, true)
	}
	return s.Answers.PublishAnswerDelta(ctx, answerstream.Delta{RequestID: run.RequestID, MessageID: messageID, Index: answerIndex, Text: deltaText, OccurredAt: time.Now().UTC()})
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
