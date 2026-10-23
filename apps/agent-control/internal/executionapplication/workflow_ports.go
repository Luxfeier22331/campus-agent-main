package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type WorkflowStarter interface {
	CancelToolExecutionWorkflow(context.Context, execution.WorkflowCancelInput) error
	// StartToolExecutionWorkflow returns only a non-empty exact root Run ID
	// verified against the input identity and reset state.
	// The reconciler persists this binding without repeating that verification.
	StartToolExecutionWorkflow(context.Context, execution.WorkflowStartInput) (string, error)
}

type WorkflowControl interface {
	DescribeToolExecutionWorkflow(context.Context, string, string) (execution.WorkflowExecutionInfo, error)
}

type WorkflowCancellationRecoveryStarter interface {
	// EnsureToolExecutionWorkflowForCancellation has the same verified-root
	// return guarantee as StartToolExecutionWorkflow, with a delayed first task.
	EnsureToolExecutionWorkflowForCancellation(context.Context, execution.WorkflowStartInput) (string, error)
}

type WorkflowFinalizer interface {
	FailWorkflowStart(context.Context, execution.DurableRun, string, error) error
	FinalizeExecutionCancellation(
		context.Context,
		execution.ExecutionCancellationFinalizationInput,
	) (execution.ExecutionCancellationFinalizationOutput, error)
	FinalizeWorkflowClosure(context.Context, execution.DurableRun, time.Time, string) error
	FinalizeWorkflowTimeout(context.Context, execution.DurableRun, time.Time) error
}

type RuntimeReadiness struct {
	Healthy    bool
	LastError  string
	TaskQueues []TaskQueueReadiness
}
type TaskQueueReadiness struct {
	Name    string
	Type    string
	Pollers int
	Healthy bool
}
type ReadinessChecker interface {
	CheckReadiness(context.Context) RuntimeReadiness
}
