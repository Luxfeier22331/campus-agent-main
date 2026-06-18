package temporalruntime

import "testing"

func TestNormalizeActivityTaskQueuesIncludesOpenedCapabilityQueues(t *testing.T) {
	queues := normalizeActivityTaskQueues([]string{
		ActivityTaskQueueKnowledgeRetrieval,
		ActivityTaskQueueCampusService,
		ActivityTaskQueueNavigation,
		ActivityTaskQueueNotice,
		ActivityTaskQueueNotice,
	})

	want := []string{
		ActivityTaskQueueContext,
		ActivityTaskQueueAgent,
		ActivityTaskQueueKnowledgePlan,
		ActivityTaskQueueKnowledgeRetrieval,
		ActivityTaskQueueKnowledgeSynthesis,
		ActivityTaskQueueFinalization,
		ActivityTaskQueueCampusService,
		ActivityTaskQueueNavigation,
		ActivityTaskQueueNotice,
	}
	if len(queues) != len(want) {
		t.Fatalf("queues = %#v, want %#v", queues, want)
	}
	for index := range want {
		if queues[index] != want[index] {
			t.Fatalf("queues = %#v, want %#v", queues, want)
		}
	}
}

func TestWorkerOptionsForProfileRejectsEmptyActivitySlots(t *testing.T) {
	_, err := WorkerOptionsForProfile(WorkerProfile{
		ActivityTaskPollers: 2,
	})
	if err == nil {
		t.Fatal("WorkerOptionsForProfile returned nil error, want activity slot validation failure")
	}
}

func TestWorkerOptionsForProfileMapsActivityConcurrency(t *testing.T) {
	options, err := WorkerOptionsForProfile(WorkerProfile{
		ActivitySlots:                4,
		ActivityTaskPollers:          2,
		TaskQueueActivitiesPerSecond: 8,
		WorkerActivitiesPerSecond:    4,
		WorkflowTaskPollers:          0,
		WorkflowTaskSlots:            0,
	})
	if err != nil {
		t.Fatalf("WorkerOptionsForProfile returned error: %v", err)
	}
	if options.MaxConcurrentActivityExecutionSize != 4 {
		t.Fatalf("activity slots = %d, want 4", options.MaxConcurrentActivityExecutionSize)
	}
	if options.MaxConcurrentActivityTaskPollers != 2 {
		t.Fatalf("activity pollers = %d, want 2", options.MaxConcurrentActivityTaskPollers)
	}
	if options.TaskQueueActivitiesPerSecond != 8 {
		t.Fatalf("task queue rate = %v, want 8", options.TaskQueueActivitiesPerSecond)
	}
	if options.WorkerActivitiesPerSecond != 4 {
		t.Fatalf("worker rate = %v, want 4", options.WorkerActivitiesPerSecond)
	}
}

func TestTracingInterceptorsAreDisabledByDefault(t *testing.T) {
	interceptors, err := NewTracingInterceptors(TracingOptions{})
	if err != nil {
		t.Fatalf("NewTracingInterceptors returned error: %v", err)
	}
	if len(interceptors) != 0 {
		t.Fatalf("interceptors = %#v, want empty when tracing is disabled", interceptors)
	}
}

func TestTracingInterceptorsRequireOTelEndpointWhenEnabled(t *testing.T) {
	_, err := NewTracingInterceptors(TracingOptions{Enabled: true})
	if err == nil {
		t.Fatal("NewTracingInterceptors returned nil error, want endpoint validation failure")
	}
}
