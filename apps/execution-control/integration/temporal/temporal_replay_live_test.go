//go:build temporal_integration

package temporal_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporaltest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestTemporalDevServerReplaysPersonalMemoryEraseHistory(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	temporalClient := packageHarness.Client
	activities := &temporalfake.Activities{}
	workflowWorker := worker.New(temporalClient, temporalruntime.WorkflowTaskQueue, temporaltest.Options())
	workflowWorker.RegisterWorkflowWithOptions(
		temporalruntime.PersonalMemoryCommandWorkflow,
		workflow.RegisterOptions{Name: temporalruntime.PersonalMemoryCommandWorkflowType},
	)
	coreWorker := runtimeassembly.NewCoreActivityWorkerWithOptions(
		temporalClient,
		temporalruntime.ActivityTaskQueueCore,
		activities,
		activities,
		temporaltest.Options(),
	)
	packageHarness.StartCustomWorkers(t,
		temporaltest.WorkerSpec{Queue: temporalruntime.WorkflowTaskQueue, Kind: "workflow", New: func(client.Client) worker.Worker { return workflowWorker }},
		temporaltest.WorkerSpec{Queue: temporalruntime.ActivityTaskQueueCore, Kind: "core", New: func(client.Client) worker.Worker { return coreWorker }},
	)

	command := temporalruntime.PersonalMemoryCommandRequest{
		CommandID:         "command-temporal-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-08-17T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-temporal-e2e",
		UserID:            "user-temporal-e2e",
	}
	workflowID := packageHarness.NewWorkflowID(command.CommandID)
	workflowRun, err := temporalClient.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: temporalruntime.WorkflowTaskQueue,
	}, temporalruntime.PersonalMemoryCommandWorkflowType, temporalruntime.PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: workflowID,
	})
	if err != nil {
		t.Fatalf("execute workflow: %v", err)
	}
	packageHarness.CleanupRun(t, workflowID, workflowRun.GetRunID())
	if err := workflowRun.Get(ctx, nil); err != nil {
		t.Fatalf("complete workflow: %v", err)
	}
	history, err := packageHarness.History(ctx, workflowID, workflowRun.GetRunID())
	if err != nil {
		t.Fatalf("read workflow history: %v", err)
	}
	if os.Getenv("UPDATE_TEMPORAL_REPLAY_FIXTURES") == "1" {
		// Worker identities and sticky queue names contain the generating host.
		// They do not affect replay; keep the public fixture synthetic.
		fixtureHistory := proto.Clone(history).(*historypb.History)
		for _, event := range fixtureHistory.Events {
			if attrs := event.GetWorkflowExecutionStartedEventAttributes(); attrs != nil {
				attrs.Identity = "integration-client"
			}
			if attrs := event.GetWorkflowTaskStartedEventAttributes(); attrs != nil {
				attrs.Identity = "integration-worker"
			}
			if attrs := event.GetWorkflowTaskCompletedEventAttributes(); attrs != nil {
				attrs.Identity = "integration-worker"
			}
			if attrs := event.GetActivityTaskStartedEventAttributes(); attrs != nil {
				attrs.Identity = "integration-worker"
			}
			if attrs := event.GetActivityTaskCompletedEventAttributes(); attrs != nil {
				attrs.Identity = "integration-worker"
			}
			if attrs := event.GetWorkflowTaskScheduledEventAttributes(); attrs != nil && attrs.GetTaskQueue().GetKind() == enumspb.TASK_QUEUE_KIND_STICKY {
				attrs.TaskQueue.Name = "integration-sticky"
			}
		}
		encodedHistory, err := protojson.Marshal(fixtureHistory)
		if err != nil {
			t.Fatal(err)
		}
		fixture := replayFixture{
			WorkflowType:      temporalruntime.PersonalMemoryCommandWorkflowType,
			GenerationVersion: "personal-memory-command/current",
			Producer:          "temporalruntime.PersonalMemoryCommandWorkflow",
			ExpectedStatus:    "succeeded", History: encodedHistory,
		}
		encoded, err := json.MarshalIndent(fixture, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll("testdata/replay", 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("testdata/replay/personal_memory_erase_v1.json", append(encoded, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Log("history replay: personal memory erase")
	replayer := worker.NewWorkflowReplayer()
	replayer.RegisterWorkflowWithOptions(temporalruntime.PersonalMemoryCommandWorkflow, workflow.RegisterOptions{
		Name: temporalruntime.PersonalMemoryCommandWorkflowType,
	})
	if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
		t.Fatalf("replay personal memory history: %v", err)
	}
}
