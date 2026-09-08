//go:build temporal_integration

package temporal_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// The first attempt intentionally misses the production 30-second heartbeat
// deadline. Temporal must retry it; the second attempt returns a valid plan.
type heartbeatTimeoutActivities struct {
	temporalfake.Activities
	attempt atomic.Int32
}

func (a *heartbeatTimeoutActivities) SolveTaskActivity(ctx context.Context, input temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	attempt := activity.GetInfo(ctx).Attempt
	a.attempt.Store(attempt)
	if attempt == 1 {
		<-ctx.Done()
		return temporalruntime.WorkflowOperationActivityOutput{}, ctx.Err()
	}
	return a.Activities.SolveTaskActivity(ctx, input)
}

func TestActivityHeartbeatTimeoutRetriesOnRealServer(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	activities := &heartbeatTimeoutActivities{}
	packageHarness.StartStandardWorkers(t, activities)
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("heartbeat-timeout"))
	input.WorkflowID = input.RequestID
	run, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID: input.WorkflowID, TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatal(err)
	}
	packageHarness.CleanupRun(t, run.GetID(), run.GetRunID())
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := run.Get(ctx, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || activities.attempt.Load() != 2 {
		t.Fatalf("result=%#v, solve attempts=%d", result, activities.attempt.Load())
	}
	history, err := packageHarness.History(ctx, run.GetID(), run.GetRunID())
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range history.Events {
		started := event.GetActivityTaskStartedEventAttributes()
		if started != nil && started.Attempt == 2 {
			failure := started.GetLastFailure().GetTimeoutFailureInfo()
			if failure == nil || failure.TimeoutType != enumspb.TIMEOUT_TYPE_HEARTBEAT {
				t.Fatalf("retry cause = %#v, want heartbeat timeout", started.LastFailure)
			}
			return
		}
	}
	t.Fatal("history did not record the second activity attempt")
}

func TestWorkflowExecutionBudgetTimesOutBeforeBlockedAgentCompletes(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	activities := &blockingAgentActivities{started: make(chan struct{})}
	packageHarness.StartStandardWorkers(t, activities)
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("execution-budget"))
	input.WorkflowID = input.RequestID
	// Exercise the same server-enforced execution budget as Starter's 900s
	// setting, shortened only in this test's StartWorkflowOptions.
	run, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID: input.WorkflowID, TaskQueue: temporalruntime.WorkflowTaskQueue,
		WorkflowExecutionTimeout: 2 * time.Second,
	}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatal(err)
	}
	packageHarness.CleanupRun(t, run.GetID(), run.GetRunID())
	select {
	case <-activities.started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var timeout *temporal.TimeoutError
	if err := run.Get(ctx, nil); !errors.As(err, &timeout) || timeout.TimeoutType() != enumspb.TIMEOUT_TYPE_START_TO_CLOSE {
		t.Fatalf("workflow result error = %v, want execution timeout", err)
	}
	history, err := packageHarness.History(ctx, run.GetID(), run.GetRunID())
	if err != nil {
		t.Fatal(err)
	}
	if !historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_TIMED_OUT) ||
		historyContainsCompletedActivity(history, temporalruntime.WriteWorkflowFinalizationActivityName) {
		t.Fatal("execution budget did not close the workflow before answer finalization")
	}
}
