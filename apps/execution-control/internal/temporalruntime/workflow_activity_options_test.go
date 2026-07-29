package temporalruntime

import (
	"testing"
	"time"
)

func TestActivityOptionsWaitForCancellationBeforeFinalization(t *testing.T) {
	base := defaultActivityOptions()
	if !base.WaitForCancellation {
		t.Fatal("base activities must wait for cancellation confirmation")
	}
	for name, options := range map[string]struct {
		wait bool
	}{
		"primary-agent": {wait: primaryAgentActivityOptions(base).WaitForCancellation},
		"memory":        {wait: memoryActivityOptions(base, 90).WaitForCancellation},
		"finalizer":     {wait: unlimitedFinalizerActivityOptions(15 * time.Second).WaitForCancellation},
	} {
		if !options.wait {
			t.Fatalf("%s activity dropped WaitForCancellation", name)
		}
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
	if options.HeartbeatTimeout != 30*time.Second {
		t.Fatalf("primary agent HeartbeatTimeout = %s, want 30s", options.HeartbeatTimeout)
	}
	if options.RetryPolicy == nil || options.RetryPolicy.MaximumAttempts != 0 {
		t.Fatalf("primary agent retry policy = %#v, want receipt-fenced unlimited repair", options.RetryPolicy)
	}
	if base.RetryPolicy == nil || base.RetryPolicy.MaximumAttempts != 3 {
		t.Fatalf("base retry policy = %#v, want isolated three-attempt policy", base.RetryPolicy)
	}
}

func TestMemoryActivityOptionsUseRuntimeConfigTimeoutAndHeartbeat(t *testing.T) {
	base := defaultActivityOptions()
	base.TaskQueue = "default"

	options := memoryActivityOptions(base, 90)
	if options.TaskQueue != ActivityTaskQueueCore {
		t.Fatalf("memory activity queue = %q, want %q", options.TaskQueue, ActivityTaskQueueCore)
	}
	if options.StartToCloseTimeout != 120*time.Second {
		t.Fatalf("memory activity StartToCloseTimeout = %s, want 120s", options.StartToCloseTimeout)
	}
	if options.HeartbeatTimeout != 30*time.Second {
		t.Fatalf("memory activity HeartbeatTimeout = %s, want 30s", options.HeartbeatTimeout)
	}
	if options.RetryPolicy == nil {
		t.Fatal("memory activity retry policy is nil")
	}
	if len(options.RetryPolicy.NonRetryableErrorTypes) == 0 {
		t.Fatalf("memory activity non-retryable error types = %#v, want explicit fail-closed classes", options.RetryPolicy.NonRetryableErrorTypes)
	}
}

func TestMemoryActivityOptionsDefaultToGovernedTimeout(t *testing.T) {
	base := defaultActivityOptions()

	options := memoryActivityOptions(base, 0)
	if options.StartToCloseTimeout != 120*time.Second {
		t.Fatalf("memory activity default StartToCloseTimeout = %s, want 120s", options.StartToCloseTimeout)
	}
}

func TestPersonalMemoryCommandRetryPolicySeparatesPrivacyDeletesFromUpserts(t *testing.T) {
	for _, commandKind := range []string{"owner_erase", "item_delete", "conversation_prune", "conversation_delete"} {
		options := personalMemoryCommandProviderActivityOptions(commandKind)
		if options.RetryPolicy == nil || options.RetryPolicy.MaximumAttempts != 0 {
			t.Fatalf("%s maximum attempts = %#v, want unlimited", commandKind, options.RetryPolicy)
		}
	}
	for _, commandKind := range []string{"item_upsert", "owner_transition"} {
		options := personalMemoryCommandProviderActivityOptions(commandKind)
		if options.RetryPolicy == nil || options.RetryPolicy.MaximumAttempts != 5 {
			t.Fatalf("%s maximum attempts = %#v, want 5", commandKind, options.RetryPolicy)
		}
	}
}

func TestFinalizerActivitiesRetryUntilDurableSideEffectsComplete(t *testing.T) {
	options := unlimitedFinalizerActivityOptions(15 * time.Second)
	if options.TaskQueue != ActivityTaskQueueCore {
		t.Fatalf("finalizer queue = %q, want %q", options.TaskQueue, ActivityTaskQueueCore)
	}
	if options.RetryPolicy == nil || options.RetryPolicy.MaximumAttempts != 0 {
		t.Fatalf("finalizer retry policy = %#v, want unlimited", options.RetryPolicy)
	}
}
