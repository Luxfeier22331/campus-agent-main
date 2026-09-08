package temporaltest

import (
	"context"
	"fmt"
	"strings"

	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
)

func (h *Harness) NewWorkflowID(prefix string) string {
	return fmt.Sprintf("integration-%s-%d", strings.ReplaceAll(prefix, "/", "-"), h.sequence.Add(1))
}

func (h *Harness) History(ctx context.Context, workflowID, runID string) (*historypb.History, error) {
	result := &historypb.History{}
	iter := h.Client.GetWorkflowHistory(ctx, workflowID, runID, false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("history namespace=%s workflow=%s run=%s: %w", h.Namespace, workflowID, runID, err)
		}
		result.Events = append(result.Events, event)
	}
	return result, nil
}
