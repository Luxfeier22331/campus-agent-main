package adaptertest

import (
	"context"
	app "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

func (a *Adapter) FinalizeExecutionCancellationApplication(ctx context.Context, in app.CancellationInput) (app.CancellationOutput, error) {
	out, err := a.FinalizeExecutionCancellation(ctx, in)
	return out, err
}
func (a *Adapter) FinalizeExecutionFailureApplication(ctx context.Context, in app.FailureInput) (app.FailureOutput, error) {
	out, err := a.FinalizeExecutionFailure(ctx, in)
	return out, err
}
func (a *Adapter) WriteWorkflowFinalizationApplication(ctx context.Context, in app.FinalizationInput) (app.FinalizationOutput, error) {
	out, err := a.WriteWorkflowFinalization(ctx, in)
	return out, err
}
