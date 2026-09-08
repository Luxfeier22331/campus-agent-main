package finalization

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Activities interface {
	temporalruntime.FinalizationActivities
	FinalizeExecutionCancellationActivity(context.Context, temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error)
	FinalizeExecutionFailureActivity(context.Context, temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error)
	WriteWorkflowFinalizationActivity(context.Context, temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error)
}
