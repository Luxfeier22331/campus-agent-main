package adaptertest

import (
	"context"
	app "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
)

func (a *Adapter) SolveTaskApplication(ctx context.Context, in app.SolveInput) (app.OperationOutput, error) {
	out, err := a.SolveTask(ctx, contract.WireSolveTaskActivityInput(in))
	return contract.AppWorkflowOperationActivityOutput(out), err
}
func (a *Adapter) ExecuteTaskStepApplication(ctx context.Context, in app.ExecuteStepInput) (app.OperationOutput, error) {
	out, err := a.ExecuteTaskStep(ctx, contract.WireExecuteTaskStepActivityInput(in))
	return contract.AppWorkflowOperationActivityOutput(out), err
}
func (a *Adapter) ReplanTaskApplication(ctx context.Context, in app.ReplanInput) (app.OperationOutput, error) {
	out, err := a.ReplanTask(ctx, contract.WireReplanTaskActivityInput(in))
	return contract.AppWorkflowOperationActivityOutput(out), err
}
func (a *Adapter) SynthesizeAnswerApplication(ctx context.Context, in app.SynthesizeInput) (app.OperationOutput, error) {
	out, err := a.SynthesizeAnswer(ctx, contract.WireSynthesizeAnswerActivityInput(in))
	return contract.AppWorkflowOperationActivityOutput(out), err
}
func (a *Adapter) FinalizeExecutionCancellationApplication(ctx context.Context, in app.CancellationInput) (app.CancellationOutput, error) {
	out, err := a.FinalizeExecutionCancellation(ctx, contract.WireFinalizeExecutionCancellationActivityInput(in))
	return contract.AppFinalizeExecutionCancellationActivityOutput(out), err
}
func (a *Adapter) FinalizeExecutionFailureApplication(ctx context.Context, in app.FailureInput) (app.FailureOutput, error) {
	out, err := a.FinalizeExecutionFailure(ctx, contract.WireFinalizeExecutionFailureActivityInput(in))
	return contract.AppFinalizeExecutionFailureActivityOutput(out), err
}
func (a *Adapter) WriteWorkflowFinalizationApplication(ctx context.Context, in app.FinalizationInput) (app.FinalizationOutput, error) {
	out, err := a.WriteWorkflowFinalization(ctx, contract.WireWriteWorkflowFinalizationActivityInput(in))
	return contract.AppWorkflowFinalizationActivityOutput(out), err
}
