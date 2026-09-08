//go:build temporal_integration

package temporal_test

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

type blockedMemoryActivities struct {
	temporalfake.Activities
	started chan struct{}
	release chan struct{}
}

func (a *blockedMemoryActivities) AppendConversationMemoryActivity(ctx context.Context, input temporalruntime.AppendConversationMemoryActivityInput) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	close(a.started)
	select {
	case <-a.release:
		return a.Activities.AppendConversationMemoryActivity(ctx, input)
	case <-ctx.Done():
		return temporalruntime.AppendConversationMemoryActivityOutput{}, ctx.Err()
	}
}

func TestFinalizationCompletesBeforeMemoryButWorkflowWaitsForAppend(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	activities := &blockedMemoryActivities{started: make(chan struct{}), release: make(chan struct{})}
	packageHarness.StartStandardWorkers(t, activities)
	t.Cleanup(func() { close(activities.release) })
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("memory-after-finalization"))
	input.WorkflowID = input.RequestID
	run, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID: input.WorkflowID, TaskQueue: temporalruntime.WorkflowTaskQueue,
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
	history, err := packageHarness.History(ctx, run.GetID(), run.GetRunID())
	if err != nil {
		t.Fatal(err)
	}
	if !historyContainsCompletedActivity(history, temporalruntime.WriteWorkflowFinalizationActivityName) ||
		historyContainsCompletedActivity(history, temporalruntime.AppendConversationMemoryActivityName) {
		t.Fatal("memory append must be pending after finalization completes")
	}
	description, err := packageHarness.Client.DescribeWorkflowExecution(ctx, run.GetID(), run.GetRunID())
	if err != nil || description.GetWorkflowExecutionInfo().GetStatus() != enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING {
		t.Fatalf("workflow must remain running while memory append is blocked: %v, %v", description, err)
	}
	activities.release <- struct{}{}
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := run.Get(ctx, &result); err != nil || result.Status != "completed" {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	history, err = packageHarness.History(ctx, run.GetID(), run.GetRunID())
	if err != nil {
		t.Fatal(err)
	}
	if !historyContainsCompletedActivity(history, temporalruntime.AppendConversationMemoryActivityName) ||
		!historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
		t.Fatal("workflow did not finish after memory append completed")
	}
}
