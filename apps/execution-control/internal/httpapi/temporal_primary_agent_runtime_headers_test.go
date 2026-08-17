package httpapi

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestCallAgentRuntimeExecutionTraceHeaders(t *testing.T) {
	const traceParent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	for _, testCase := range []struct {
		name            string
		traceParent     string
		wantTraceParent string
	}{
		{name: "valid", traceParent: traceParent, wantTraceParent: traceParent},
		{name: "empty"},
		{name: "invalid", traceParent: "not-a-traceparent"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			var seenHeaders http.Header
			agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				seenHeaders = request.Header.Clone()
				writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
					"status":       "completed",
					"run_id":       "run-trace-propagation-001",
					"final_output": "ok",
					"tool_results": []any{},
				})
			}))
			defer agentRuntime.Close()

			server := NewServer(config.Config{
				AgentRuntimeBaseURL:      agentRuntime.URL,
				AgentRuntimeSharedSecret: "agent-secret",
				AgentRuntimeDeadlineMS:   1000,
			})
			run := execution.DurableRun{
				RunID:     "run-trace-propagation-001",
				RequestID: "req-trace-propagation-001",
				TraceID:   "trace-trace-propagation-001",
			}
			_, err := server.callAgentRuntime(
				context.Background(),
				run,
				temporalruntime.ExecutePrimaryAgentActivityInput{
					RunID:       run.RunID,
					TraceParent: testCase.traceParent,
				},
				"hello",
				providerconfig.RuntimeSetting{},
				nil,
				temporalruntime.CampusDocsRetrievalResult{Evidence: []temporalruntime.CampusDocsEvidence{}},
				server.primaryAgentRuntimeLimits(),
				1,
			)
			if err != nil {
				t.Fatalf("call agent runtime: %v", err)
			}

			assertions := map[string]string{
				"traceparent":  testCase.wantTraceParent,
				"x-request-id": run.RequestID,
				"x-trace-id":   run.TraceID,
			}
			for name, want := range assertions {
				if got := seenHeaders.Get(name); got != want {
					t.Errorf("agent runtime %s header = %q, want %q", name, got, want)
				}
			}
			if got := seenHeaders.Get("baggage"); got != "" {
				t.Errorf("agent runtime baggage header = %q, want empty", got)
			}
			if got := seenHeaders.Get("sentry-trace"); got != "" {
				t.Errorf("agent runtime sentry-trace header = %q, want empty", got)
			}
		})
	}
}
