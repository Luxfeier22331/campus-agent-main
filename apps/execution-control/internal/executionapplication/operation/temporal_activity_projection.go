package operation

import (
	"context"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
)

func (s *OperationService) TemporalActivityRun(
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
