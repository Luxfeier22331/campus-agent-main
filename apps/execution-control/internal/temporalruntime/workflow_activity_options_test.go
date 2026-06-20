package temporalruntime

import (
	"testing"
	"time"
)

func TestKnowledgeActivityOptionsUseSpecializedTaskQueues(t *testing.T) {
	base := defaultActivityOptions()
	checks := []struct {
		name  string
		queue string
	}{
		{name: PlanRAGActivityName, queue: ActivityTaskQueueKnowledgePlan},
		{name: RetrieveIndexedLookupActivityName, queue: ActivityTaskQueueKnowledgeRetrieval},
		{name: SelectEvidenceActivityName, queue: ActivityTaskQueueKnowledgePlan},
		{name: SynthesizeRAGAnswerActivityName, queue: ActivityTaskQueueKnowledgeSynthesis},
		{name: VerifyGroundingActivityName, queue: ActivityTaskQueueKnowledgePlan},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			options := knowledgeActivityOptions(base, check.name)
			if options.TaskQueue != check.queue {
				t.Fatalf("%s queue = %q, want %q", check.name, options.TaskQueue, check.queue)
			}
		})
	}
}

func TestPrimaryAgentActivityUsesRealProviderTimeoutWindow(t *testing.T) {
	base := defaultActivityOptions()
	base.TaskQueue = "default"

	options := primaryAgentActivityOptions(base)
	if options.TaskQueue != ActivityTaskQueueAgent {
		t.Fatalf("primary agent queue = %q, want %q", options.TaskQueue, ActivityTaskQueueAgent)
	}
	if options.StartToCloseTimeout != 180*time.Second {
		t.Fatalf("primary agent StartToCloseTimeout = %s, want 180s", options.StartToCloseTimeout)
	}
}
