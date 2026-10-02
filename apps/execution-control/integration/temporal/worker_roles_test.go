//go:build temporal_integration

package temporal_test

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/temporalfake"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
)

func TestProductionWorkerRuntimeStopsAndRestartsWithQueuedWork(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Second)
	defer cancel()
	cfg := config.Config{
		TemporalAddress:   packageHarness.Address,
		TemporalNamespace: packageHarness.Namespace,
		TemporalTaskQueue: temporalruntime.WorkflowTaskQueue,
		WorkerProfiles: map[string]config.WorkerProfile{
			"workflow":       {WorkflowTaskSlots: 16, WorkflowTaskPollers: 2},
			"activity-core":  {ActivitySlots: 8, ActivityTaskPollers: 2},
			"activity-agent": {ActivitySlots: 4, ActivityTaskPollers: 2},
		},
	}
	activities := &temporalfake.Activities{}
	start := func() *runtimeassembly.Runtime {
		runtime, err := runtimeassembly.StartWorkers(ctx, cfg, activities, activities, activities, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(runtime.Stop)
		if !runtime.Ready() {
			t.Fatal("started runtime is not ready")
		}
		return runtime
	}
	runtime := start()
	runtime.StartDraining()
	if runtime.Ready() {
		t.Fatal("draining runtime remains ready")
	}
	runtime.Stop()
	runtime.Stop()
	if runtime.Ready() {
		t.Fatal("stopped runtime remains ready")
	}
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("worker-restart"))
	input.WorkflowID = packageHarness.NewWorkflowID(input.RequestID)
	run, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: input.WorkflowID, TaskQueue: cfg.TemporalTaskQueue}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatal(err)
	}
	packageHarness.CleanupRun(t, input.WorkflowID, run.GetRunID())
	restarted := start()
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := run.Get(ctx, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" {
		t.Fatalf("queued result = %#v", result)
	}
	restarted.Stop()
}
