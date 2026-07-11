package temporalruntime

import (
	"context"
	"reflect"
	"testing"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func TestNewStarterDefersConnectivityToReadiness(t *testing.T) {
	starter, err := NewStarter(context.Background(), StarterOptions{
		Address:   "127.0.0.1:1",
		Namespace: "default",
		TaskQueue: WorkflowTaskQueue,
	})
	if err != nil {
		t.Fatalf("NewStarter returned error: %v", err)
	}
	defer starter.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	readiness := starter.CheckReadiness(ctx)
	if readiness.Healthy {
		t.Fatal("CheckReadiness reported healthy for unavailable Temporal")
	}
}

func TestNormalizeActivityTaskQueuesDeduplicatesWorkloadQueues(t *testing.T) {
	queues := normalizeActivityTaskQueues([]string{
		ActivityTaskQueueCore,
		ActivityTaskQueueCore,
		ActivityTaskQueueAgent,
	})

	want := []string{
		ActivityTaskQueueCore,
		ActivityTaskQueueAgent,
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
	if len(interceptors.Client) != 0 || len(interceptors.Worker) != 0 {
		t.Fatalf("interceptors = %#v, want empty when tracing is disabled", interceptors)
	}
}

func TestTracingInterceptorsRequireOTelEndpointWhenEnabled(t *testing.T) {
	_, err := NewTracingInterceptors(TracingOptions{Enabled: true})
	if err == nil {
		t.Fatal("NewTracingInterceptors returned nil error, want endpoint validation failure")
	}
}

func TestTracingInterceptorsProduceTemporalSDKInterceptorsWhenEnabled(t *testing.T) {
	interceptors, err := NewTracingInterceptors(TracingOptions{
		Enabled:      true,
		OTelEndpoint: "http://collector:4318/v1/traces",
	})
	if err != nil {
		t.Fatalf("NewTracingInterceptors returned error: %v", err)
	}
	if len(interceptors.Client) != 1 {
		t.Fatalf("client interceptors = %d, want 1", len(interceptors.Client))
	}
	if len(interceptors.Worker) != 1 {
		t.Fatalf("worker interceptors = %d, want 1", len(interceptors.Worker))
	}
	if got := reflect.TypeOf(interceptors.Client[0]).String(); got == "*temporalruntime.TracingInterceptor" {
		t.Fatalf("client interceptor type = %s, want Temporal SDK tracing interceptor", got)
	}
}

func TestTracingInterceptorsApplyToTemporalOptions(t *testing.T) {
	interceptors, err := NewTracingInterceptors(TracingOptions{
		Enabled:      true,
		OTelEndpoint: "http://collector:4318/v1/traces",
	})
	if err != nil {
		t.Fatalf("NewTracingInterceptors returned error: %v", err)
	}

	clientOptions := ApplyTracingToClientOptions(client.Options{}, interceptors)
	workerOptions := ApplyTracingToWorkerOptions(worker.Options{}, interceptors)

	if len(clientOptions.Interceptors) != 1 {
		t.Fatalf("client options interceptors = %d, want 1", len(clientOptions.Interceptors))
	}
	if len(workerOptions.Interceptors) != 1 {
		t.Fatalf("worker options interceptors = %d, want 1", len(workerOptions.Interceptors))
	}
}
