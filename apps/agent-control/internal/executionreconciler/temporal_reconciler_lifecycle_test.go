package executionreconciler

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"reflect"
	"testing"
)

type recordingTemporalReconcilerStore struct {
	executionapplication.RunStore
	calls []string
}

func (s *recordingTemporalReconcilerStore) LeaseRunCancellationCommands(
	context.Context,
	execution.LifecycleLeaseRequest,
) ([]execution.RunCancellationCommand, error) {
	s.calls = append(s.calls, "cancellations")
	return nil, nil
}

func (s *recordingTemporalReconcilerStore) LeaseWorkflowStartIntents(
	context.Context,
	execution.LifecycleLeaseRequest,
) ([]execution.WorkflowStartIntent, error) {
	s.calls = append(s.calls, "starts")
	return nil, nil
}

func (s *recordingTemporalReconcilerStore) ListActiveWorkflowRuns(
	context.Context,
	string,
	int,
) ([]execution.ActiveWorkflowRun, error) {
	s.calls = append(s.calls, "timeouts")
	return nil, nil
}

func TestTemporalReconcilerPreservesCancellationStartTimeoutOrder(t *testing.T) {
	store := &recordingTemporalReconcilerStore{
		RunStore: executionpersistence.NewInMemoryRunProjectionStore(),
	}
	reconciler := newReconcilerForTest(
		config.Config{},
		store,
		&reconcilerStarterForTest{},
		nil,
	)
	reconciler.ReconcileOnce(context.Background())

	want := []string{"cancellations", "starts", "timeouts"}
	if !reflect.DeepEqual(store.calls, want) {
		t.Fatalf("reconcile order = %#v, want %#v", store.calls, want)
	}
}
