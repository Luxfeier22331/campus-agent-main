package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityPassesCurrentModelVisibleTools(t *testing.T) {
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
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "需要查询学校账号规则。"},
			"provider_response_id": "resp-primary-agent-institutional-account",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:institutional-account",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-institutional-account",
		RequestID:        "req-primary-agent-institutional-account",
		RunID:            "run-primary-agent-institutional-account",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-institutional-account",
		VisibleToolNames: []string{"knowledge_query", "transport_schedule_lookup"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_tool_names"].([]any)
	if !ok {
		t.Fatalf("visible_tool_names missing or wrong type: %#v", seenBody)
	}
	if len(visible) != 2 || visible[0] != "knowledge_query" || visible[1] != "transport_schedule_lookup" {
		t.Fatalf("visible_tool_names = %#v, want current model-visible tools", visible)
	}
}

func TestExecutePrimaryAgentActivityPassesKnowledgeTargets(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 35, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-knowledge-scopes",
		"conv-primary-agent-knowledge-scopes",
		now,
		ragHandoffForDurableWorkerTest("转专业条件是什么？"),
	)
	policyPath := filepath.Join(t.TempDir(), "query-serving-targets.v1.json")
	if err := os.WriteFile(policyPath, []byte(`{
		"schema_version": "query-serving-targets-v1",
		"targets": [
			{
				"target": "student_rules",
				"collection": "student_rules",
				"description": "学生规则、学籍、奖助处分等正式制度。",
				"serving_config_path": "regulations/student_rules/serving-config.json",
				"retrieval_top_k": 8
			}
		]
	}`), 0o600); err != nil {
		t.Fatalf("write query-serving policy: %v", err)
	}
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-scopes",
			"final_output":         "需要查询正式知识库。",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "需要查询正式知识库。"},
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"provider_response_id": "resp-primary-agent-knowledge-scopes",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		QueryServingTargetsPath:  policyPath,
		TemporalWorkerIdentity:   "test:agent:knowledge-scopes",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-knowledge-scopes",
		RequestID:        "req-primary-agent-knowledge-scopes",
		RunID:            "run-primary-agent-knowledge-scopes",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-knowledge-scopes",
		VisibleToolNames: []string{"knowledge_query"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	targets, ok := seenBody["knowledge_targets"].([]any)
	if !ok || len(targets) != 1 {
		t.Fatalf("knowledge_targets missing or wrong type: %#v", seenBody)
	}
	target, ok := targets[0].(map[string]any)
	if !ok {
		t.Fatalf("knowledge target = %#v", targets[0])
	}
	if target["target"] != "student_rules" ||
		target["description"] != "学生规则、学籍、奖助处分等正式制度。" {
		t.Fatalf("knowledge target = %#v", target)
	}
}

func TestExecutePrimaryAgentActivityPreservesExplicitCampusServicesTool(t *testing.T) {
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
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:explicit-services",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-explicit-services",
		RequestID:        "req-primary-agent-explicit-services",
		RequestedTool:    "transport_schedule_lookup",
		RunID:            "run-primary-agent-explicit-services",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-explicit-services",
		VisibleToolNames: []string{"transport_schedule_lookup"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_tool_names"].([]any)
	if !ok {
		t.Fatalf("visible_tool_names missing or wrong type: %#v", seenBody)
	}
	if len(visible) != 1 || visible[0] != "transport_schedule_lookup" {
		t.Fatalf("visible_tool_names = %#v, want only transport_schedule_lookup", visible)
	}
}
