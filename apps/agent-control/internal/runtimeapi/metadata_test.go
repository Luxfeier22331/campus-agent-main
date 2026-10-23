package runtimeapi

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/runtimeprojection"
	"testing"
	"time"
)

type bindingStore struct {
	executionapplication.StepProjectionStore
	binding execution.WorkflowStartIntent
}

func (s bindingStore) GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error) {
	return s.binding, nil
}
func TestRemoteActivityAttemptsAndIdentity(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	frozen := agenttest.CreateQueuedRun(t, store, "remote-evidence")
	run, err := store.GetRun(t.Context(), frozen.Wire.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	bound := bindingStore{store, execution.WorkflowStartIntent{WorkflowID: "workflow", TemporalRunID: "root", State: execution.LifecycleIntentStateConfirmed}}
	writer := projection.Writer{RunProjectionStore: store}
	now := time.Now().UTC().Truncate(time.Microsecond)
	metadata := executioncontract.ActivityMetadata{WorkflowID: "workflow", TemporalRunID: "root", ActivityID: "prepare", ActivityType: "prepareStage", ActivityAttempt: 1, TaskQueue: "agent-model", ScheduledAt: now, StartedAt: now.Add(time.Second)}
	for _, attempt := range []int32{1, 2} {
		metadata.ActivityAttempt = attempt
		ctx, err := runtimeprojection.BindActivity(t.Context(), bound, run.RequestID, metadata)
		if err != nil {
			t.Fatal(err)
		}
		if err = writer.ProjectStep(ctx, projection.StepProjection{Run: run, StepID: "solve.initial", StepKind: "solver", Status: "started", StartedAt: metadata.StartedAt, UpdatedAt: metadata.StartedAt}); err != nil {
			t.Fatal(err)
		}
	}
	attempts, err := store.ListStepAttempts(t.Context(), run.RequestID)
	if err != nil || len(attempts) != 2 {
		t.Fatalf("attempts=%v err=%v", attempts, err)
	}
	for _, a := range attempts {
		if a.WorkflowID != "workflow" || a.TemporalRunID != "root" || a.ActivityID != "prepare" || a.ActivityType != "prepareStage" || a.TaskQueue != "agent-model" || a.ScheduleToStartMS != 1000 {
			t.Fatalf("lost remote evidence: %#v", a)
		}
	}
	for _, change := range []func(*executioncontract.ActivityMetadata){func(m *executioncontract.ActivityMetadata) { m.WorkflowID = "other" }, func(m *executioncontract.ActivityMetadata) { m.TemporalRunID = "other" }, func(m *executioncontract.ActivityMetadata) { m.ActivityAttempt = 0 }} {
		invalid := metadata
		change(&invalid)
		if _, err = runtimeprojection.BindActivity(t.Context(), bound, run.RequestID, invalid); err == nil {
			t.Fatal("invalid evidence accepted")
		}
	}
}
