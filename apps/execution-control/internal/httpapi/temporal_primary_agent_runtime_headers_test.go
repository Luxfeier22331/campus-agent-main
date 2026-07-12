package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestCallAgentRuntimeForwardsExecutionTraceHeaders(t *testing.T) {
	const traceParent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	const baggage = "release=2026.07.11"
	incomingHeaders := http.Header{}
	incomingHeaders.Set("traceparent", traceParent)
	incomingHeaders.Set("baggage", baggage)
	requestContext := telemetry.ExtractIncomingContext(context.Background(), incomingHeaders)

	var seenHeaders http.Header
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		seenHeaders = request.Header.Clone()
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":         "completed",
			"run_id":         "run-trace-propagation-001",
			"final_output":   "ok",
			"selected_tools": []string{},
			"tool_results":   []any{},
		})
	}))
	defer agentRuntime.Close()

	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
	})
	run := execution.DurableRun{
		RunID:     "run-trace-propagation-001",
		RequestID: "req-trace-propagation-001",
		TraceID:   "trace-trace-propagation-001",
	}
	_, err := server.callAgentRuntime(
		requestContext,
		run,
		temporalruntime.ExecutePrimaryAgentActivityInput{RunID: run.RunID},
		providerConfigSnapshot{},
		nil,
	)
	if err != nil {
		t.Fatalf("call agent runtime: %v", err)
	}

	assertions := map[string]string{
		"traceparent":  traceParent,
		"baggage":      baggage,
		"x-request-id": run.RequestID,
		"x-trace-id":   run.TraceID,
	}
	for name, want := range assertions {
		if got := seenHeaders.Get(name); got != want {
			t.Errorf("agent runtime %s header = %q, want %q", name, got, want)
		}
	}
}
