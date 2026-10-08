//go:build temporal_integration

package temporal_test

import (
	"context"
	"go.temporal.io/sdk/activity"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
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

// A real SDK worker must expose live slots and finish its accepted activity when
// its pollers are stopped. A replacement executes subsequent workflow tasks.
func TestProductionWorkerDrainsAcceptedActivityAndExportsSlots(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	activities := &drainingActivities{started: make(chan struct{}), release: make(chan struct{}), stopping: make(chan struct{})}
	cfg := config.Config{
		TemporalAddress: packageHarness.Address, TemporalNamespace: packageHarness.Namespace,
		TemporalTaskQueue: temporalruntime.WorkflowTaskQueue,
		WorkerProfiles: map[string]config.WorkerProfile{
			"workflow":       {WorkflowTaskSlots: 16, WorkflowTaskPollers: 2},
			"activity-core":  {ActivitySlots: 8, ActivityTaskPollers: 2},
			"activity-agent": {ActivitySlots: 4, ActivityTaskPollers: 2},
		},
	}
	runtime, err := runtimeassembly.StartWorkers(ctx, cfg, activities, activities, activities, nil)
	if err != nil {
		t.Fatal(err)
	}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(activities.release) }) }
	t.Cleanup(func() { release(); runtime.Stop() })
	input := temporalfake.WorkflowInput(packageHarness.NewWorkflowID("worker-drain"))
	input.WorkflowID = packageHarness.NewWorkflowID(input.RequestID)
	run, err := packageHarness.Client.ExecuteWorkflow(ctx, client.StartWorkflowOptions{ID: input.WorkflowID, TaskQueue: cfg.TemporalTaskQueue}, temporalruntime.ToolExecutionWorkflow, input)
	if err != nil {
		t.Fatal(err)
	}
	packageHarness.CleanupRun(t, input.WorkflowID, run.GetRunID())
	select {
	case <-activities.started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	recorder := httptest.NewRecorder()
	runtime.MetricsHandler().ServeHTTP(recorder, httptest.NewRequestWithContext(t.Context(), "GET", "/metrics", nil))
	if !strings.Contains(recorder.Body.String(), `temporal_worker_task_slots_used{task_queue="campus-agent.activity.agent.v3",worker_type="ActivityWorker"} 1`) {
		t.Fatal(recorder.Body.String())
	}
	stopped := make(chan struct{})
	go func() { runtime.Stop(); close(stopped) }()
	select {
	case <-activities.stopping:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-stopped:
		t.Fatal("worker exited before accepted activity finished")
	default:
	}
	release()
	select {
	case <-stopped:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	replacement, err := runtimeassembly.StartWorkers(ctx, cfg, activities, activities, activities, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(replacement.Stop)
	var result temporalruntime.ToolExecutionWorkflowResult
	if err := run.Get(ctx, &result); err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || activities.calls.Load() != 1 {
		t.Fatalf("result=%#v calls=%d", result, activities.calls.Load())
	}
}

type drainingActivities struct {
	temporalfake.Activities
	started  chan struct{}
	release  chan struct{}
	stopping chan struct{}
	calls    atomic.Int32
}

func (a *drainingActivities) SolveTaskActivity(ctx context.Context, input temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	if a.calls.Add(1) == 1 {
		close(a.started)
		select {
		case <-activity.GetWorkerStopChannel(ctx):
			close(a.stopping)
		case <-ctx.Done():
			return temporalruntime.WorkflowOperationActivityOutput{}, ctx.Err()
		}
		select {
		case <-a.release:
		case <-ctx.Done():
			return temporalruntime.WorkflowOperationActivityOutput{}, ctx.Err()
		}
	}
	return a.Activities.SolveTaskActivity(ctx, input)
}
