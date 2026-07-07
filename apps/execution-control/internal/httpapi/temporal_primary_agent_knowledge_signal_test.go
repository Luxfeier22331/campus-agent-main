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

func TestExecutePrimaryAgentActivityAllowsKnowledgeSignalWithoutFinalOutput(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 45, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-knowledge-signal",
		"conv-primary-agent-knowledge-signal",
		now,
		ragHandoffForDurableWorkerTest("学籍管理规定是什么"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-signal",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-knowledge-signal",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-knowledge-signal",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "knowledge_query",
				"tool":         "knowledge_query",
				"payload_kind": "knowledge_query",
				"arguments_json": map[string]any{
					"query_text":       "学籍管理规定是什么",
					"intent":           "answer_question",
					"requested_scope":  nil,
					"query_mode":       "current",
					"version_query":    map[string]any{"mode": "current", "as_of": nil, "version_id": nil, "compare_to_version_id": nil},
					"freshness_intent": nil,
					"constraints":      nil,
				},
				"result_ref": "agent-runtime://run-primary-agent-knowledge-signal/tools/knowledge_query",
				"result":     map[string]any{"workflow_signal": "knowledge_query"},
			}},
			"terminal_reason": "tool_selected",
			"usage": map[string]any{
				"input_tokens":             18,
				"output_tokens":            4,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 19,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:knowledge-signal",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-knowledge-signal",
		RequestID:        "req-primary-agent-knowledge-signal",
		RunID:            "run-primary-agent-knowledge-signal",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-knowledge-signal",
		VisibleToolNames: []string{"knowledge_query"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if output.FinalOutput != "" {
		t.Fatalf("final output = %q, want empty workflow signal", output.FinalOutput)
	}
	if len(output.SelectedTools) != 1 || output.SelectedTools[0] != "knowledge_query" {
		t.Fatalf("selected tools = %#v", output.SelectedTools)
	}
	if output.TerminalReason != "tool_selected" {
		t.Fatalf("terminal reason = %q", output.TerminalReason)
	}
	run, err := store.GetRun(context.Background(), "run-primary-agent-knowledge-signal")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	agentMetadata, ok := run.Metadata["temporal_agent"].(map[string]any)
	if !ok {
		t.Fatalf("temporal_agent metadata = %#v", run.Metadata["temporal_agent"])
	}
	if agentMetadata["terminal_reason"] != "tool_selected" {
		t.Fatalf("agent metadata = %#v", agentMetadata)
	}
}
