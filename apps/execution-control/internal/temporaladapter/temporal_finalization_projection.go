package temporaladapter

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func temporalFinalizationResultPayload(
	finalizedResponse map[string]any,
	input temporalruntime.WriteFinalizationActivityInput,
	run execution.DurableRun,
) map[string]any {
	payload := map[string]any{
		"agent_result_ref":     input.AgentResult.AgentResultRef,
		"finalization_summary": temporalFinalizationProjectionSummary(finalizedResponse),
		"request_id":           run.RequestID,
	}
	payload["finalization_fingerprint_sha256"] = sha256AnyValue(payload)
	return payload
}

func temporalFinalizationProjectionSummary(finalizedResponse map[string]any) map[string]any {
	result := execution.OptionalMapFromMap(finalizedResponse, "result")
	sourceCount := 0
	campusSourceCount := 0
	webSourceCount := 0
	switch sources := result["sources"].(type) {
	case []any:
		sourceCount = len(sources)
		for _, source := range sources {
			kind := execution.StringValue(execution.CloneAnyMapFromValue(source)["kind"])
			switch kind {
			case "campus_document":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	case []map[string]any:
		sourceCount = len(sources)
		for _, source := range sources {
			switch execution.StringValue(source["kind"]) {
			case "campus_document":
				campusSourceCount++
			case "web_page":
				webSourceCount++
			}
		}
	}
	answerText := execution.StringValue(finalizedResponse["answer_text"])
	return map[string]any{
		"answer_text":         answerText,
		"answer_text_sha256":  sha256AnyValue(answerText),
		"campus_source_count": campusSourceCount,
		"response_sha256":     sha256AnyValue(finalizedResponse),
		"source_count":        sourceCount,
		"status":              execution.StringValue(finalizedResponse["status"]),
		"web_source_count":    webSourceCount,
	}
}

func (s *Adapter) appendTemporalFinalizationCompletedEvents(
	ctx context.Context,
	run execution.DurableRun,
	occurredAt time.Time,
	finalizedResponse map[string]any,
	payload map[string]any,
) error {
	internalPayload := execution.CloneAnyMapFromValue(payload)
	internalPayload["response"] = finalizedResponse
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":finalization-completed-internal",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              internalPayload,
	}); err != nil {
		return err
	}
	browserPayload := map[string]any{
		"request_id": run.RequestID,
	}
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":finalization-completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              browserPayload,
	})
}
