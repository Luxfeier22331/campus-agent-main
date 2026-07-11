package temporalruntime

import (
	"testing"
	"time"
)

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

func TestMemoryActivityOptionsUseRuntimeConfigTimeoutAndHeartbeat(t *testing.T) {
	base := defaultActivityOptions()
	base.TaskQueue = "default"

	options := memoryActivityOptions(base, 90)
	if options.TaskQueue != ActivityTaskQueueCore {
		t.Fatalf("memory activity queue = %q, want %q", options.TaskQueue, ActivityTaskQueueCore)
	}
	if options.StartToCloseTimeout != 90*time.Second {
		t.Fatalf("memory activity StartToCloseTimeout = %s, want 90s", options.StartToCloseTimeout)
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
	if options.StartToCloseTimeout != 90*time.Second {
		t.Fatalf("memory activity default StartToCloseTimeout = %s, want 90s", options.StartToCloseTimeout)
	}
}
