package control

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type FinalizationHandler interface {
	FailWorkflowStart(context.Context, execution.DurableRun, string, error) error
	FinalizeWorkflowClosure(context.Context, execution.DurableRun, time.Time, string) error
	FinalizeWorkflowTimeout(context.Context, execution.DurableRun, time.Time) error
	FinalizeExecutionCancellation(context.Context, temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error)
}
type Finalizer struct{ Adapter FinalizationHandler }

func NewFinalizer(adapter FinalizationHandler) *Finalizer { return &Finalizer{Adapter: adapter} }
func (f *Finalizer) FailWorkflowStart(ctx context.Context, run execution.DurableRun, code string, cause error) error {
	return f.Adapter.FailWorkflowStart(ctx, run, code, cause)
}
func (f *Finalizer) FinalizeWorkflowClosure(ctx context.Context, run execution.DurableRun, at time.Time, status string) error {
	return f.Adapter.FinalizeWorkflowClosure(ctx, run, at, status)
}
func (f *Finalizer) FinalizeWorkflowTimeout(ctx context.Context, run execution.DurableRun, at time.Time) error {
	return f.Adapter.FinalizeWorkflowTimeout(ctx, run, at)
}
func (f *Finalizer) FinalizeExecutionCancellation(ctx context.Context, in execution.ExecutionCancellationFinalizationInput) (execution.ExecutionCancellationFinalizationOutput, error) {
	out, err := f.Adapter.FinalizeExecutionCancellation(ctx, temporalruntime.FinalizeExecutionCancellationActivityInput{CanceledAt: in.CanceledAt, Reason: in.Reason, RequestID: in.RequestID})
	return execution.ExecutionCancellationFinalizationOutput{RequestID: out.RequestID, Status: out.Status}, err
}

type Gateway struct{ Starter *temporalruntime.Starter }

func (g *Gateway) StartToolExecutionWorkflow(ctx context.Context, input execution.WorkflowStartInput) (string, error) {
	return g.Starter.StartToolExecutionWorkflow(ctx, workflowcontract.WorkflowInput(input))
}
func (g *Gateway) EnsureToolExecutionWorkflowForCancellation(ctx context.Context, input execution.WorkflowStartInput) (string, error) {
	return g.Starter.EnsureToolExecutionWorkflowForCancellation(ctx, workflowcontract.WorkflowInput(input))
}
func (g *Gateway) CancelToolExecutionWorkflow(ctx context.Context, input execution.WorkflowCancelInput) error {
	return g.Starter.CancelToolExecutionWorkflow(ctx, temporalruntime.ToolExecutionWorkflowCancelInput{
		Reason: input.Reason, RequestID: input.RequestID, TemporalRunID: input.TemporalRunID, WorkflowID: input.WorkflowID,
	})
}
func (g *Gateway) DescribeToolExecutionWorkflow(ctx context.Context, workflowID, runID string) (execution.WorkflowExecutionInfo, error) {
	return g.Starter.DescribeToolExecutionWorkflow(ctx, workflowID, runID)
}
func (g *Gateway) StartPersonalMemoryCommandWorkflow(ctx context.Context, input executionapplication.PersonalMemoryCommandInput) error {
	return g.Starter.StartPersonalMemoryCommandWorkflow(ctx, temporalruntime.PersonalMemoryCommandWorkflowInput{Command: workflowcontract.MemoryCommandToWorkflow(input.Command), WorkflowID: input.WorkflowID})
}
func (g *Gateway) CheckReadiness(ctx context.Context) executionapplication.RuntimeReadiness {
	r := g.Starter.CheckReadiness(ctx)
	out := executionapplication.RuntimeReadiness{Healthy: r.Healthy, LastError: r.LastError}
	for _, q := range r.TaskQueues {
		out.TaskQueues = append(out.TaskQueues, executionapplication.TaskQueueReadiness(q))
	}
	return out
}

var _ executionapplication.WorkflowGateway = (*Gateway)(nil)
var _ executionapplication.WorkflowControl = (*Gateway)(nil)
var _ executionapplication.WorkflowCancellationRecoveryStarter = (*Gateway)(nil)
