package temporalruntime

import "testing"

func TestNormalizeActivityTaskQueuesIncludesOpenedCapabilityQueues(t *testing.T) {
	queues := normalizeActivityTaskQueues([]string{
		ActivityTaskQueueKnowledge,
		ActivityTaskQueueCampusService,
		ActivityTaskQueueNavigation,
		ActivityTaskQueueNotice,
		ActivityTaskQueueNotice,
	})

	want := []string{
		ActivityTaskQueueContext,
		ActivityTaskQueueAgent,
		ActivityTaskQueueKnowledge,
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
