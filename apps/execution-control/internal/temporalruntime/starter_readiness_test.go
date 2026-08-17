package temporalruntime

import (
	"context"
	"testing"
	"time"
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
