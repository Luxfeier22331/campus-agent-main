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
		"context":         server.TemporalContextActivities(),
		"agent":           server.TemporalAgentActivities(),
		"knowledge_query": server.TemporalKnowledgeActivities(),
		"typed_tool":      server.TemporalTypedToolActivities(),
		"finalization":    server.TemporalFinalizationActivities(),
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
		"MemoryRecallActivity",
		"PlanRouteActivity",
	} {
		if _, ok := contextType.MethodByName(method); !ok {
			t.Fatalf("context activities missing %s", method)
		}
	}
	if _, ok := contextType.MethodByName("UpdateInferredMemoryActivity"); ok {
		t.Fatal("context activities still expose retired UpdateInferredMemoryActivity")
	}
	if _, ok := contextType.MethodByName("PlanRAGActivity"); ok {
		t.Fatal("context activities expose knowledge method")
	}

	agentType := reflect.TypeOf(server.TemporalAgentActivities())
	if _, ok := agentType.MethodByName("ExecutePrimaryAgentActivity"); !ok {
		t.Fatal("agent activities missing ExecutePrimaryAgentActivity")
	}
	if _, ok := agentType.MethodByName("PlanRouteActivity"); ok {
		t.Fatal("agent activities expose context method")
	}

	knowledgeType := reflect.TypeOf(server.TemporalKnowledgeActivities())
	for _, method := range []string{
		"PlanRAGActivity",
		"RetrieveIndexedLookupActivity",
		"ExpandOrRescueRetrievalActivity",
		"SelectEvidenceActivity",
		"SynthesizeRAGAnswerActivity",
		"VerifyGroundingActivity",
	} {
		if _, ok := knowledgeType.MethodByName(method); !ok {
			t.Fatalf("knowledge activities missing %s", method)
		}
	}
	if _, ok := knowledgeType.MethodByName("PlanRouteActivity"); ok {
		t.Fatal("knowledge activities expose context method")
	}

	typedToolType := reflect.TypeOf(server.TemporalTypedToolActivities())
	if _, ok := typedToolType.MethodByName("ExecuteTypedToolActivity"); !ok {
		t.Fatal("typed tool activities missing ExecuteTypedToolActivity")
	}
	if _, ok := typedToolType.MethodByName("ExecuteAgentAsToolActivity"); !ok {
		t.Fatal("typed tool activities missing ExecuteAgentAsToolActivity")
	}
	if _, ok := typedToolType.MethodByName("PlanRAGActivity"); ok {
		t.Fatal("typed tool activities expose knowledge method")
	}

	finalizationType := reflect.TypeOf(server.TemporalFinalizationActivities())
	if _, ok := finalizationType.MethodByName("WriteFinalizationActivity"); !ok {
		t.Fatal("finalization activities missing WriteFinalizationActivity")
	}
	for _, method := range []string{
		"PlanRouteActivity",
		"MemoryRecallActivity",
		"PlanRAGActivity",
		"RetrieveIndexedLookupActivity",
		"ExpandOrRescueRetrievalActivity",
		"SelectEvidenceActivity",
		"SynthesizeRAGAnswerActivity",
		"VerifyGroundingActivity",
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
			server.TemporalTypedToolActivities(),
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
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewKnowledgeActivityWorkerWithOptions(
			temporalClient,
			"test-knowledge",
			server.TemporalKnowledgeActivities(),
			workerOptionsForRegistrationTest(),
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
