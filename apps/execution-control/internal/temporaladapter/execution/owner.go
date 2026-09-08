package execution

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Adapter struct {
	*activityprojection.Writer
	AgentRuntimeClient executionapplication.AgentRuntimeClient
	Receipts           *executionapplication.ReceiptService
}

func New(adapter Adapter) *Adapter { return &adapter }
func (a *Adapter) SolveTaskActivity(ctx context.Context, in temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SolveTask(ctx, in)
}
func (a *Adapter) ExecuteTaskStepActivity(ctx context.Context, in temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ExecuteTaskStep(ctx, in)
}
func (a *Adapter) ReplanTaskActivity(ctx context.Context, in temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ReplanTask(ctx, in)
}
func (a *Adapter) SynthesizeAnswerActivity(ctx context.Context, in temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SynthesizeAnswer(ctx, in)
}

var _ Activities = (*Adapter)(nil)
