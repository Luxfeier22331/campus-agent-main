package finalization

import (
	"context"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
)

type unavailableTimingStore struct {
	*executionpersistence.InMemoryRunProjectionStore
}

func (s unavailableTimingStore) ListStepAttempts(ctx context.Context, _ string) ([]execution.StepAttemptProjection, error) {
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nil, errors.New("timing read unavailable")
}

func TestOptionalTimingFailurePreservesAnswer(t *testing.T) {
	adapter := &FinalizationService{Writer: &activityprojection.Writer{
		RunProjectionStore: unavailableTimingStore{executionpersistence.NewInMemoryRunProjectionStore()},
	}}
	result := map[string]any{"final_output": "可用回答", "usage": map[string]any{"input_tokens": 10, "output_tokens": 5}}
	response, err := adapter.WorkflowFinalizedResponse(t.Context(), execution.DurableRun{RequestID: "timing-failure"}, result)
	if err != nil || response["status"] != "completed" || response["answer_text"] != "可用回答" {
		t.Fatalf("response = %#v, error = %v", response, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := adapter.WorkflowFinalizedResponse(ctx, execution.DurableRun{}, result); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}
