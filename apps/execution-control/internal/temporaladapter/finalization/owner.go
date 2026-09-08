package finalization

import (
	"context"
	"io"
	"log/slog"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Adapter struct {
	*activityprojection.Writer
	AdmissionService execution.AdmissionService
	Logger           *slog.Logger
}

func New(adapter Adapter) *Adapter {
	if adapter.Logger == nil {
		adapter.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &adapter
}
func (a *Adapter) FinalizeExecutionCancellationActivity(ctx context.Context, in temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return a.FinalizeExecutionCancellation(ctx, in)
}
func (a *Adapter) FinalizeExecutionFailureActivity(ctx context.Context, in temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return a.FinalizeExecutionFailure(ctx, in)
}
func (a *Adapter) WriteWorkflowFinalizationActivity(ctx context.Context, in temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return a.WriteWorkflowFinalization(ctx, in)
}

var _ Activities = (*Adapter)(nil)
