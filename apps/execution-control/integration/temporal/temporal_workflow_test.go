//go:build temporal_integration

package temporal_test

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func TestTemporalDevServerRunsToolExecutionWorkflowAndReplaysHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	temporalClient := packageHarness.Client
	activities := &temporalfake.Activities{}
	packageHarness.StartStandardWorkers(t, activities)

	runID := packageHarness.NewWorkflowID("workflow-replay")
	input := temporalfake.WorkflowInput(runID)
	input.WorkflowID = packageHarness.NewWorkflowID(runID)
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	packageHarness.CleanupRun(t, input.WorkflowID, workflowRun.GetRunID())
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.RequestID != runID || result.Status != "completed" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}
	readiness := newStarter(t, ctx).CheckReadiness(ctx)
	if !readiness.Healthy {
		t.Fatalf("temporal readiness = %#v", readiness)
	}

	history, err := packageHarness.History(ctx, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	if !historyContains(history, enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED) {
		t.Fatal("workflow history did not contain completed event")
	}
	replayer := worker.NewWorkflowReplayer()
	t.Log("history replay: current ToolExecutionWorkflow")
	replayer.RegisterWorkflowWithOptions(temporalruntime.ToolExecutionWorkflow, workflow.RegisterOptions{
		Name: temporalruntime.ToolExecutionWorkflowType,
	})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatalf("replay workflow history: %v", err)
	}
}

func TestTemporalDevServerRunsPlannedWorkflowActivities(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	temporalClient := packageHarness.Client
	activities := &temporalfake.Activities{}
	packageHarness.StartStandardWorkers(t, activities)

	runID := packageHarness.NewWorkflowID("workflow-plan")
	input := temporalfake.WorkflowInput(runID)
	input.WorkflowID = packageHarness.NewWorkflowID(runID)
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        input.WorkflowID,
		TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	packageHarness.CleanupRun(t, input.WorkflowID, workflowRun.GetRunID())
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.RequestID != runID || result.Status != "completed" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}

	history, err := packageHarness.History(ctx, input.WorkflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	expected := []string{
		temporalruntime.SolveTaskActivityName,
		temporalruntime.ExecuteTaskStepActivityName,
		temporalruntime.SynthesizeAnswerActivityName,
		temporalruntime.WriteWorkflowFinalizationActivityName,
	}
	scheduled := map[int64]string{}
	var completed []string
	for _, event := range history.Events {
		if attrs := event.GetActivityTaskScheduledEventAttributes(); attrs != nil {
			scheduled[event.EventId] = attrs.GetActivityType().GetName()
		}
		if attrs := event.GetActivityTaskCompletedEventAttributes(); attrs != nil {
			completed = append(completed, scheduled[attrs.ScheduledEventId])
		}
	}
	if !reflect.DeepEqual(completed, expected) {
		t.Fatalf("completed activity order = %v, want %v", completed, expected)
	}
}

func TestTemporalDevServerRunsPersonalMemoryCommandFinalizers(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	temporalClient := packageHarness.Client
	activities := &temporalfake.Activities{}
	packageHarness.StartStandardWorkers(t, activities)

	command := temporalruntime.PersonalMemoryCommandRequest{
		CommandID:         packageHarness.NewWorkflowID("memory-command"),
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-temporal-e2e",
		UserID:            "user-temporal-e2e",
	}
	workflowID := packageHarness.NewWorkflowID(command.CommandID)
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.PersonalMemoryCommandWorkflow, temporalruntime.PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: workflowID,
	})
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	packageHarness.CleanupRun(t, workflowID, workflowRun.GetRunID())
	var result temporalruntime.PersonalMemoryCommandWorkflowResult
	if err := workflowRun.Get(ctx, &result); err != nil {
		t.Fatalf("get workflow result: %v", err)
	}
	if result.CommandID != command.CommandID || result.Status != "succeeded" {
		t.Fatalf("unexpected workflow result: %#v", result)
	}

	history, err := packageHarness.History(ctx, workflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("workflow history: %v", err)
	}
	for _, activityName := range []string{
		temporalruntime.ExecutePersonalMemoryCommandActivityName,
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityName,
		temporalruntime.WritePersonalMemoryCommandResultActivityName,
	} {
		if !historyContainsCompletedActivity(history, activityName) {
			t.Fatalf("workflow history missing completed activity %s", activityName)
		}
	}
}
