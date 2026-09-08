package temporalruntime

import (
	"testing"
)

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
