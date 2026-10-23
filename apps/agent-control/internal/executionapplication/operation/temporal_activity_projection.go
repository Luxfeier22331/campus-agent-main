package operation

import (
	"context"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
)

func (s *RunProjectionService) TemporalActivityRun(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.RunProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.RunProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if activityprojection.RunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("request %s is already terminal: %s", run.RequestID, run.Status)
	}
	return run, nil
}

func (s *RunProjectionService) ListRunSteps(ctx context.Context, requestID string) ([]execution.RunStepProjection, error) {
	return s.RunProjectionStore.ListRunSteps(ctx, requestID)
}

func (s *RunProjectionService) ListStepAttempts(ctx context.Context, requestID string) ([]execution.StepAttemptProjection, error) {
	return s.RunProjectionStore.ListStepAttempts(ctx, requestID)
}
