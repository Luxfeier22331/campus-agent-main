package execution

import (
	"context"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
)

func (s *Adapter) TemporalActivityRun(
	ctx context.Context,
	requestID string,
) (execution.DurableRun, error) {
	if s == nil || s.RunProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.EnsureTemporalActivityOwnsRootExecution(ctx, requestID, false); err != nil {
		return execution.DurableRun{}, err
	}
	run, err := s.RunProjectionStore.GetRun(ctx, requestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	if activityprojection.TemporalRunTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("request %s is already terminal: %s", run.RequestID, run.Status)
	}
	return run, nil
}
