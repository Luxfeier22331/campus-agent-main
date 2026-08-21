package httpapi

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) appendTemporalRunProgress(
	ctx context.Context,
	run execution.DurableRun,
	phase execution.DurableRunProgressPhase,
	occurredAt time.Time,
) error {
	return s.appendTemporalRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RunID + ":progress:" + string(phase),
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunProgress,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-progress-event-v1",
		Payload: map[string]any{
			"phase":      string(phase),
			"request_id": run.RequestID,
			"trace_id":   run.TraceID,
		},
	})
}
