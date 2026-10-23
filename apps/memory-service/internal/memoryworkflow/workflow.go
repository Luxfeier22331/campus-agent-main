package memoryworkflow

import (
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
	"time"
)

const WorkflowQueue = "campus-agent.memory.workflow.v1"
const ActivityQueue = "campus-agent.memory.activity.v1"
const Type = "MemoryOperationWorkflow"

type Input struct {
	ID string `json:"command_id"`
}
type Progress struct {
	Status string `json:"status"`
}

func Operation(ctx workflow.Context, in Input) error {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{TaskQueue: ActivityQueue, StartToCloseTimeout: 300 * time.Second, HeartbeatTimeout: 30 * time.Second, WaitForCancellation: true, RetryPolicy: &temporal.RetryPolicy{InitialInterval: 2 * time.Second, MaximumInterval: 30 * time.Second}})
	for {
		var p Progress
		if err := workflow.ExecuteActivity(ctx, "AdvanceMemoryOperation", in).Get(ctx, &p); err != nil {
			return err
		}
		switch p.Status {
		case "completed", "succeeded", "failed", "skipped":
			return nil
		}
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			return workflow.NewContinueAsNewError(ctx, Type, in)
		}
		if err := workflow.Sleep(ctx, 5*time.Second); err != nil {
			return err
		}
	}
}
