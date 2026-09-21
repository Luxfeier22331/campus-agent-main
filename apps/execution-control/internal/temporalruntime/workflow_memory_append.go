package temporalruntime

import (
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const MemoryAppendWorkflowType = "MemoryAppendWorkflow"
const AdvanceMemoryAppendActivityName = "AdvanceMemoryAppendActivity"
const memoryAppendVersion = "async-memory-append-v1"

type MemoryAppendWorkflowInput struct {
	RequestID string    `json:"request_id"`
	Submitted bool      `json:"submitted"`
	StartedAt time.Time `json:"started_at"`
}

// MemoryAppendWorkflow retries transport/observation, never a terminal remote
// retain task. Continue-as-new preserves the same admitted message and task ID.
func MemoryAppendWorkflow(ctx workflow.Context, input MemoryAppendWorkflowInput) error {
	if input.StartedAt.IsZero() {
		input.StartedAt = workflow.Now(ctx)
	}
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           ActivityTaskQueueCore,
		StartToCloseTimeout: 300 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval: 2 * time.Second, BackoffCoefficient: 2,
			MaximumInterval: 30 * time.Second,
		},
	})
	for {
		var output AppendConversationMemoryActivityOutput
		if err := workflow.ExecuteActivity(ctx, AdvanceMemoryAppendActivityName, input).Get(ctx, &output); err != nil {
			return err
		}
		switch output.Status {
		case "completed", "failed", "skipped", "cancelled":
			return nil
		}
		input.Submitted = true
		if err := workflow.Sleep(ctx, 10*time.Second); err != nil {
			return err
		}
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			return workflow.NewContinueAsNewError(ctx, MemoryAppendWorkflowType, input)
		}
	}
}

func startMemoryAppendWorkflow(ctx workflow.Context, requestID string) error {
	ctx = workflow.WithChildOptions(ctx, workflow.ChildWorkflowOptions{
		WorkflowID:            "memory.append/" + requestID,
		ParentClosePolicy:     enumspb.PARENT_CLOSE_POLICY_ABANDON,
		WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		// Zero execution/run timeouts intentionally leave this background work
		// independent of the answer's execution deadline.
	})
	future := workflow.ExecuteChildWorkflow(ctx, MemoryAppendWorkflowType, MemoryAppendWorkflowInput{RequestID: requestID})
	return future.GetChildWorkflowExecution().Get(ctx, nil)
}
