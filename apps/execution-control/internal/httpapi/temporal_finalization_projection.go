package httpapi

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
	return map[string]any{
		"finalized_response": finalizedResponse,
		"grounding_ref":      input.GroundingRef,
		"request_id":         run.RequestID,
		"synthesis_ref":      input.SynthesisRef,
		"trace_id":           run.TraceID,
	}
}

func (s *Server) appendTemporalFinalizationCompletedEvents(
	ctx context.Context,
	run execution.DurableRun,
	occurredAt time.Time,
	finalizedResponse map[string]any,
	payload map[string]any,
) error {
	internalPayload := cloneAnyMapFromMetadata(payload)
	internalPayload["response"] = finalizedResponse
	if err := s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":finalization-completed-internal",
		RunID:                run.RunID,
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
		"trace_id":   run.TraceID,
	}
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":finalization-completed",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              browserPayload,
	})
}
