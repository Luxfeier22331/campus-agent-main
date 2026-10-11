package execution

import (
	"context"
	service "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/activitysupport"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/executioncontext"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"time"
)

type Adapter struct{ Service *service.OperationService }

func New(a Adapter) *Adapter { return &a }
func (a *Adapter) SolveTask(ctx context.Context, in temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	stop := activitysupport.StartTemporalActivityHeartbeat(ctx, "workflow.solve", 10*time.Second)
	defer stop()
	out, err := call.SolveTask(ctx, contract.AppSolveTaskActivityInput(in))
	return contract.WireWorkflowOperationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) SolveTaskActivity(ctx context.Context, in temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SolveTask(ctx, in)
}
func (a *Adapter) ExecuteTaskStep(ctx context.Context, in temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	stop := activitysupport.StartTemporalActivityHeartbeat(ctx, "workflow.execute_step", 10*time.Second)
	defer stop()
	out, err := call.ExecuteTaskStep(ctx, contract.AppExecuteTaskStepActivityInput(in))
	return contract.WireWorkflowOperationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) ExecuteTaskStepActivity(ctx context.Context, in temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ExecuteTaskStep(ctx, in)
}
func (a *Adapter) ReplanTask(ctx context.Context, in temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	stop := activitysupport.StartTemporalActivityHeartbeat(ctx, "workflow.replan", 10*time.Second)
	defer stop()
	out, err := call.ReplanTask(ctx, contract.AppReplanTaskActivityInput(in))
	return contract.WireWorkflowOperationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) ReplanTaskActivity(ctx context.Context, in temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ReplanTask(ctx, in)
}
func (a *Adapter) SynthesizeAnswer(ctx context.Context, in temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if err := executioncontext.EnsureRootExecution(ctx, a.Service.RunProjectionStore, in.RequestID, false); err != nil {
		return temporalruntime.WorkflowOperationActivityOutput{}, err
	}
	call := *a.Service
	writer := *call.Writer
	writer.Evidence = executioncontext.InvocationEvidence(ctx)
	call.Writer = &writer
	stop := activitysupport.StartTemporalActivityHeartbeat(ctx, "workflow.synthesize", 10*time.Second)
	defer stop()
	out, err := call.SynthesizeAnswer(ctx, contract.AppSynthesizeAnswerActivityInput(in))
	return contract.WireWorkflowOperationActivityOutput(out), activitysupport.MapApplicationError(err)
}
func (a *Adapter) SynthesizeAnswerActivity(ctx context.Context, in temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SynthesizeAnswer(ctx, in)
}

var _ Activities = (*Adapter)(nil)
