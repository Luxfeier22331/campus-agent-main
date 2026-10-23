package control

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient"
)

type Gateway struct{ Starter *temporalclient.Starter }

func (g *Gateway) StartToolExecutionWorkflow(ctx context.Context, input execution.WorkflowStartInput) (string, error) {
	return g.Starter.StartToolExecutionWorkflow(ctx, WorkflowInput(input))
}
func (g *Gateway) EnsureToolExecutionWorkflowForCancellation(ctx context.Context, input execution.WorkflowStartInput) (string, error) {
	return g.Starter.EnsureToolExecutionWorkflowForCancellation(ctx, WorkflowInput(input))
}
func (g *Gateway) CancelToolExecutionWorkflow(ctx context.Context, input execution.WorkflowCancelInput) error {
	return g.Starter.CancelToolExecutionWorkflow(ctx, temporalclient.ToolExecutionWorkflowCancelInput{
		Reason: input.Reason, RequestID: input.RequestID, TemporalRunID: input.TemporalRunID, WorkflowID: input.WorkflowID,
	})
}
func (g *Gateway) DescribeToolExecutionWorkflow(ctx context.Context, workflowID, runID string) (execution.WorkflowExecutionInfo, error) {
	return g.Starter.DescribeToolExecutionWorkflow(ctx, workflowID, runID)
}
func (g *Gateway) CheckReadiness(ctx context.Context) executionapplication.RuntimeReadiness {
	r := g.Starter.CheckReadiness(ctx)
	out := executionapplication.RuntimeReadiness{Healthy: r.Healthy, LastError: r.LastError}
	for _, q := range r.TaskQueues {
		out.TaskQueues = append(out.TaskQueues, executionapplication.TaskQueueReadiness(q))
	}
	return out
}

var _ executionapplication.ReadinessChecker = (*Gateway)(nil)
var _ executionapplication.WorkflowControl = (*Gateway)(nil)
var _ executionapplication.WorkflowCancellationRecoveryStarter = (*Gateway)(nil)
