package operation

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

func (s *RunProjectionService) AppendTemporalRunProgress(
	ctx context.Context,
	run execution.DurableRun,
	phase execution.DurableRunProgressPhase,
	occurredAt time.Time,
) error {
	return s.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              run.RequestID + ":progress:" + string(phase),
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunProgress,
		OccurredAt:           occurredAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-progress-event-v1",
		Payload: map[string]any{
			"phase":      string(phase),
			"request_id": run.RequestID,
		},
	})
}
