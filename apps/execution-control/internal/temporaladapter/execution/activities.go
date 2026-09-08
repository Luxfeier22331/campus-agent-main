package execution

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

// Activities is the execution activity boundary used by worker assembly.
// Implementations are deliberately narrower than the combined legacy adapter.
type Activities interface {
	temporalruntime.WorkflowActivities
	SolveTaskActivity(context.Context, temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error)
	ExecuteTaskStepActivity(context.Context, temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error)
	ReplanTaskActivity(context.Context, temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error)
	SynthesizeAnswerActivity(context.Context, temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error)
}
