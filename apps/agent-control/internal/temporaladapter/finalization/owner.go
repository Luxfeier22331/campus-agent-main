package finalization

import (
	"context"
	service "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/activitysupport"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/executioncontext"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalruntime"
)

type Adapter struct{ Service *service.FinalizationService }

func New(a Adapter) *Adapter { return &a }
func (a *Adapter) FinalizeExecutionCancellation(ctx context.Context, in temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, true); err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	out, err := call.FinalizeCancellation(ctx, contract.AppFinalizeExecutionCancellationActivityInput(in))
	return contract.WireFinalizeExecutionCancellationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) FinalizeExecutionCancellationActivity(ctx context.Context, in temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return a.FinalizeExecutionCancellation(ctx, in)
}
func (a *Adapter) FinalizeExecutionFailure(ctx context.Context, in temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	out, err := call.FinalizeExecutionFailure(ctx, contract.AppFinalizeExecutionFailureActivityInput(in))
	return contract.WireFinalizeExecutionFailureActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) FinalizeExecutionFailureActivity(ctx context.Context, in temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return a.FinalizeExecutionFailure(ctx, in)
}
func (a *Adapter) WriteWorkflowFinalization(ctx context.Context, in temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	out, err := call.WriteWorkflowFinalization(ctx, contract.AppWriteWorkflowFinalizationActivityInput(in))
	return contract.WireWorkflowFinalizationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) WriteWorkflowFinalizationActivity(ctx context.Context, in temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return a.WriteWorkflowFinalization(ctx, in)
}

var _ Activities = (*Adapter)(nil)
