package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityPassesCurrentEmptyToolSet(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 33, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-institutional-account",
		"conv-primary-agent-institutional-account",
		now,
		agentRequestForDurableWorkerTest("校园网密码怎么改？"),
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
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-institutional-account",
		RequestID:        "req-primary-agent-institutional-account",
		RunID:            "run-primary-agent-institutional-account",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-institutional-account",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_tool_names"].([]any)
	if !ok {
		t.Fatalf("visible_tool_names missing or wrong type: %#v", seenBody)
	}
	if len(visible) != 0 {
		t.Fatalf("visible_tool_names = %#v, want none", visible)
	}
	if seenBody["allow_ungrounded_answer"] != false {
		t.Fatalf("institutional request ungrounded-answer policy = %#v", seenBody)
	}
}

func TestExecutePrimaryAgentActivityPassesAuthorizedPersonalMemoryTool(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 35, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-personal-memory",
		"conv-primary-agent-personal-memory",
		now,
		agentRequestForDurableWorkerTest("我上次说过喜欢哪个食堂？"),
	)
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-personal-memory",
			"final_output":         "你之前提到喜欢一食堂。",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你之前提到喜欢一食堂。"},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"provider_response_id": "resp-primary-agent-personal-memory",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:personal-memory",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-personal-memory",
		RequestID:        "req-primary-agent-personal-memory",
		RunID:            "run-primary-agent-personal-memory",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-personal-memory",
		VisibleToolNames: []string{personalMemoryRecallToolName},
	})
	_, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	visible, ok := seenBody["visible_tool_names"].([]any)
	if !ok || len(visible) != 1 || visible[0] != personalMemoryRecallToolName {
		t.Fatalf("visible_tool_names = %#v, want personal memory recall", seenBody["visible_tool_names"])
	}
	limits := cloneAnyMapFromMetadata(seenBody["limits"])
	if limits["max_turns"] != float64(2) || limits["max_tool_calls"] != float64(1) {
		t.Fatalf("limits = %#v, want bounded personal memory strategy", limits)
	}
	targets, _ := seenBody["document_scopes"].([]any)
	if len(targets) != 0 {
		t.Fatalf("document_scopes = %#v, want none", seenBody["document_scopes"])
	}
}

func TestExecutePrimaryAgentActivityRejectsClosedInstitutionalTool(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 34, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-explicit-services",
		"conv-primary-agent-explicit-services",
		now,
		agentRequestForDurableWorkerTest("校园网密码怎么改？"),
	)
	requests := 0
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests++
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

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-explicit-services",
		RequestID:        "req-primary-agent-explicit-services",
		RunID:            "run-primary-agent-explicit-services",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-explicit-services",
		VisibleToolNames: []string{"transport_schedule_lookup"},
	})
	_, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
	if err == nil || !strings.Contains(err.Error(), "admission_snapshot_invalid") {
		t.Fatalf("closed tool admission error = %v", err)
	}
	if requests != 0 {
		t.Fatalf("agent runtime requests = %d, want none", requests)
	}
}
