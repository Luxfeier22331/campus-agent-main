package httpapi

import (
	"reflect"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
)

func TestTemporalActivitySetsDoNotExposeServerLifecycleMethods(t *testing.T) {
	server := &Server{}

	for name, activities := range map[string]any{
		"context":      server.TemporalContextActivities(),
		"knowledge":    server.TemporalKnowledgeActivities(),
		"typed_tool":   server.TemporalTypedToolActivities(),
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
		"PlanRouteActivity",
		"MemoryRecallActivity",
	} {
		if _, ok := contextType.MethodByName(method); !ok {
			t.Fatalf("context activities missing %s", method)
		}
	}
	if _, ok := contextType.MethodByName("PlanRAGActivity"); ok {
		t.Fatal("context activities expose knowledge method")
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
		worker := temporalruntime.NewContextActivityWorker(
			temporalClient,
			"test-context",
			server.TemporalContextActivities(),
		)
		worker.Stop()
	})
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewKnowledgeActivityWorker(
			temporalClient,
			"test-knowledge",
			server.TemporalKnowledgeActivities(),
		)
		worker.Stop()
	})
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewTypedToolActivityWorker(
			temporalClient,
			"test-campus-services",
			server.TemporalTypedToolActivities(),
		)
		worker.Stop()
	})
	assertDoesNotPanic(t, func() {
		worker := temporalruntime.NewFinalizationActivityWorker(
			temporalClient,
			"test-finalization",
			server.TemporalFinalizationActivities(),
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
