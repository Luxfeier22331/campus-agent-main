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
		"rag":          server.TemporalRAGActivities(),
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

	ragType := reflect.TypeOf(server.TemporalRAGActivities())
	for _, method := range []string{"PlanChatAnswerActivity", "InvokeSemanticWorkerActivity"} {
		if _, ok := ragType.MethodByName(method); !ok {
			t.Fatalf("rag activities missing %s", method)
		}
	}
	if _, ok := ragType.MethodByName("FinalizeChatAnswerActivity"); ok {
		t.Fatal("rag activities expose finalization method")
	}

	finalizationType := reflect.TypeOf(server.TemporalFinalizationActivities())
	if _, ok := finalizationType.MethodByName("FinalizeChatAnswerActivity"); !ok {
		t.Fatal("finalization activities missing FinalizeChatAnswerActivity")
	}
	for _, method := range []string{"PlanChatAnswerActivity", "InvokeSemanticWorkerActivity"} {
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
		worker := temporalruntime.NewRAGActivityWorker(
			temporalClient,
			"test-rag",
			server.TemporalRAGActivities(),
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
