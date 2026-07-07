package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityFailsClosedWhenDebugTraceProjectionMissing(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 36, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-debug-trace-missing",
		"conv-primary-agent-debug-trace-missing",
		now,
		ragHandoffForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("agent runtime must not be called without observability projection")
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:debug-trace-missing",
	})
	server.providerConfigResolver = staticProviderConfigResolver{
		"primary_agent": primaryAgentProviderConfigSnapshotForTest(),
	}
	server.observabilityConfigResolver = nil
	server.observabilityConfigErr = errObservabilityConfigResolverNotConfigured
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(
		context.Background(),
		temporalruntime.ExecutePrimaryAgentActivityInput{
			RunID:   "run-primary-agent-debug-trace-missing",
			TraceID: "trace-executor-001",
		},
	)
	if err == nil {
		t.Fatal("expected missing observability projection to fail")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-debug-trace-missing")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	if len(steps) != 1 ||
		steps[0].SanitizedPayload["failure_kind"] != "llm_debug_trace_config_unavailable" {
		t.Fatalf("projected steps = %#v", steps)
	}
}
