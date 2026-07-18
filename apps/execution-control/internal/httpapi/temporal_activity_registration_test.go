package httpapi

import (
	"reflect"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func TestTemporalActivitySetsDoNotExposeServerLifecycleMethods(t *testing.T) {
	server := &Server{}

	for name, activities := range map[string]any{
		"context":      server.TemporalContextActivities(),
		"agent":        server.TemporalAgentActivities(),
		"finalization": server.TemporalFinalizationActivities(),
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

func TestTemporalActivitySetsExposeOnlyTheirQueueMethods(t *testing.T) {
	server := &Server{}

	contextType := reflect.TypeOf(server.TemporalContextActivities())
	for _, method := range []string{
		"AppendConversationMemoryActivity",
		"ExecutePersonalMemoryCommandActivity",
		"FinalizePersonalMemoryCommandReceiptActivity",
		"MemoryReflectActivity",
		"MemoryRecallActivity",
		"PurgePersonalMemoryTracesActivity",
		"VerifyPersonalMemoryTracesActivity",
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

	agentType := reflect.TypeOf(server.TemporalAgentActivities())
	if _, ok := agentType.MethodByName("ExecutePrimaryAgentActivity"); !ok {
		t.Fatal("agent activities missing ExecutePrimaryAgentActivity")
	}
	if _, ok := agentType.MethodByName("PlanRouteActivity"); ok {
		t.Fatal("agent activities expose context method")
	}

	finalizationType := reflect.TypeOf(server.TemporalFinalizationActivities())
	if _, ok := finalizationType.MethodByName("WriteFinalizationActivity"); !ok {
		t.Fatal("finalization activities missing WriteFinalizationActivity")
	}
	if _, ok := finalizationType.MethodByName("FinalizeExecutionFailureActivity"); !ok {
		t.Fatal("finalization activities missing FinalizeExecutionFailureActivity")
	}
	for _, method := range []string{
		"PlanRouteActivity",
		"MemoryRecallActivity",
		"ExecutePrimaryAgentActivity",
	} {
		if _, ok := finalizationType.MethodByName(method); ok {
			t.Fatalf("finalization activities expose %s", method)
		}
	}
}

func TestTemporalActivityWorkerRegistrationAcceptsActivitySets(t *testing.T) {
	server := &Server{}
	temporalClient, err := client.NewLazyClient(client.Options{})
	if err != nil {
		t.Fatalf("temporal client: %v", err)
	}
	defer temporalClient.Close()
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			"test-core",
			server.TemporalContextActivities(),
			server.TemporalFinalizationActivities(),
			workerOptionsForRegistrationTest(),
		)
		worker.Stop()
	})
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewAgentActivityWorker(
			temporalClient,
			"test-agent",
			server.TemporalAgentActivities(),
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
