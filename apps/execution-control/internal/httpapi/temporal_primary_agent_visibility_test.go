package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityNarrowsInstitutionalAccountQuestionToKnowledge(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 33, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-institutional-account",
		"conv-primary-agent-institutional-account",
		now,
		ragHandoffForDurableWorkerTest("校园网密码怎么改？"),
	)
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-institutional-account",
			"final_output":         "",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-institutional-account",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results":         []any{},
			"terminal_reason":      "tool_selected",
			"provider_response_id": "resp-primary-agent-institutional-account",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:institutional-account",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-institutional-account",
		RequestID:           "req-primary-agent-institutional-account",
		RunID:               "run-primary-agent-institutional-account",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-institutional-account",
		VisibleCapabilities: []string{"knowledge", "campus_services", "notice"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_capabilities"].([]any)
	if !ok {
		t.Fatalf("visible_capabilities missing or wrong type: %#v", seenBody)
	}
	if len(visible) != 1 || visible[0] != "knowledge" {
		t.Fatalf("visible_capabilities = %#v, want only knowledge", visible)
	}
}

func TestExecutePrimaryAgentActivityPreservesExplicitCampusServicesCapability(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 34, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-explicit-services",
		"conv-primary-agent-explicit-services",
		now,
		ragHandoffForDurableWorkerTest("校园网密码怎么改？"),
	)
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-explicit-services",
			"final_output":         "服务能力显式请求已保留。",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "服务能力显式请求已保留。"},
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-explicit-services",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"provider_response_id": "resp-primary-agent-explicit-services",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:explicit-services",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-explicit-services",
		RequestID:           "req-primary-agent-explicit-services",
		RequestedCapability: "campus_services",
		RunID:               "run-primary-agent-explicit-services",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-explicit-services",
		VisibleCapabilities: []string{"campus_services"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_capabilities"].([]any)
	if !ok {
		t.Fatalf("visible_capabilities missing or wrong type: %#v", seenBody)
	}
	if len(visible) != 1 || visible[0] != "campus_services" {
		t.Fatalf("visible_capabilities = %#v, want only campus_services", visible)
	}
}
