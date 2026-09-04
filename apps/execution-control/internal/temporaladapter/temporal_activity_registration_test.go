package temporaladapter

import (
	"reflect"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimeassembly"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func TestTemporalActivitySetsDoNotExposeServerLifecycleMethods(t *testing.T) {
	server := &Adapter{}
	sets := runtimeassembly.NewActivitySets(server)

	for name, activities := range map[string]any{
		"context":      sets.Context,
		"agent":        sets.Agent,
		"finalization": sets.Finalization,
	} {
		activityType := reflect.TypeOf(activities)
		if activityType == nil {
			t.Fatalf("%s activities are nil", name)
		}
		if _, ok := activityType.MethodByName("MarkTemporalWorkersStarted"); ok {
			t.Fatalf("%s activities expose MarkTemporalWorkersStarted", name)
		}
	}
}

func TestTemporalActivityInterfacesExposeOnlyTheirQueueMethods(t *testing.T) {
	contextType := reflect.TypeOf((*temporalruntime.ContextActivities)(nil)).Elem()
	for _, method := range []string{
		"AppendConversationMemoryActivity",
		"ExecutePersonalMemoryCommandActivity",
		"FinalizePersonalMemoryCommandReceiptActivity",
		"WritePersonalMemoryCommandResultActivity",
	} {
		if _, ok := contextType.MethodByName(method); !ok {
			t.Fatalf("context activities missing %s", method)
		}
	}
	if _, ok := contextType.MethodByName("PlanRouteActivity"); ok {
		t.Fatal("context activities expose retired PlanRouteActivity")
	}
	if _, ok := contextType.MethodByName("UpdateInferredMemoryActivity"); ok {
		t.Fatal("context activities still expose retired UpdateInferredMemoryActivity")
	}

	agentType := reflect.TypeOf((*temporalruntime.AgentActivities)(nil)).Elem()
	if _, ok := agentType.MethodByName("ExecutePrimaryAgentActivity"); !ok {
		t.Fatal("agent activities missing ExecutePrimaryAgentActivity")
	}
	if _, ok := agentType.MethodByName("PlanRouteActivity"); ok {
		t.Fatal("agent activities expose context method")
	}

	finalizationType := reflect.TypeOf((*temporalruntime.FinalizationActivities)(nil)).Elem()
	if _, ok := finalizationType.MethodByName("WriteFinalizationActivity"); !ok {
		t.Fatal("finalization activities missing WriteFinalizationActivity")
	}
	if _, ok := finalizationType.MethodByName("FinalizeExecutionFailureActivity"); !ok {
		t.Fatal("finalization activities missing FinalizeExecutionFailureActivity")
	}
	for _, method := range []string{
		"PlanRouteActivity",
		"MemoryRecallActivity",
	} {
		if _, ok := finalizationType.MethodByName(method); ok {
			t.Fatalf("finalization activities expose %s", method)
		}
	}
	if _, ok := contextType.MethodByName("MemoryRecallActivity"); ok {
		t.Fatal("context activities expose retired MemoryRecallActivity")
	}
}

func TestTemporalActivityWorkerRegistrationAcceptsActivitySets(t *testing.T) {
	server := &Adapter{}
	sets := runtimeassembly.NewActivitySets(server)
	temporalClient, err := client.NewLazyClient(client.Options{})
	if err != nil {
		t.Fatalf("temporal client: %v", err)
	}
	defer temporalClient.Close()
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			"test-core",
			sets.Context,
			sets.Finalization,
			workerOptionsForRegistrationTest(),
		)
		worker.Stop()
	})
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewAgentActivityWorker(
			temporalClient,
			"test-agent",
			sets.Agent,
		)
		worker.Stop()
	})
}

func assertDoesNotPanic(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recovered := recover(); recovered != nil {
			t.Fatalf("unexpected panic: %v", recovered)
		}
	}()
	fn()
}

func workerOptionsForRegistrationTest() worker.Options {
	return worker.Options{}
}
