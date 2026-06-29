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

func TestExecutePrimaryAgentActivitySendsFinalModelContextFromConversationEnvelope(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 31, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-context",
		"conv-primary-agent-context",
		now,
		ragHandoffForDurableWorkerTest("那大一能不能申请？"),
	)
	setExecutionPayloadConversationContextForRunTest(t, store, "run-primary-agent-context", map[string]any{
		"schema_version":    "conversation_context.v1",
		"conversation_id":   "conv-primary-agent-context",
		"user_message_id":   "msg_user_003",
		"parent_message_id": "msg_assistant_002",
		"current_user_message": map[string]any{
			"role":       "user",
			"content":    "那大一能不能申请？",
			"created_at": "2026-06-12T10:31:00Z",
		},
		"previous_answer_summary": "上一轮围绕转专业申请条件回答。",
		"previous_evidence_refs": []any{
			map[string]any{
				"access_scope":  "public_student_rule",
				"content_hash":  "sha256:transfer-major-evidence-example",
				"document_id":   "transfer-major-policy",
				"evidence_id":   "ev_transfer_rule_01",
				"section_title": "申请条件",
				"snippet":       "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。",
				"source_id":     "regulations/student_rules/transfer-major/v2026",
				"title":         "本科生转专业管理办法",
				"version_id":    "rule-transfer-major-2026",
			},
		},
		"previous_tool_results": []any{
			map[string]any{
				"tool":           "transport_schedule_lookup",
				"content_hash":   "sha256:previous-service-result",
				"projection_ref": "projection://runs/run_previous_services/finalization",
				"request_id":     "req_previous_services",
				"result_kind":    "final_response",
				"run_id":         "run_previous_services",
				"status":         "completed",
				"summary":        "上一轮查询了图书馆开放状态。",
			},
		},
		"recent_turns": []any{
			map[string]any{
				"message_id": "msg_user_001",
				"role":       "user",
				"content":    "转专业条件是什么？",
			},
			map[string]any{
				"message_id": "msg_assistant_002",
				"role":       "assistant",
				"summary":    "上一轮回答的是转专业申请条件。",
			},
		},
		"session_state": map[string]any{"confirmed_slots": []any{}, "turn_count": 2},
		"visibility": map[string]any{
			"model_visible": []any{
				"current_user_message",
				"recent_turns",
				"previous_answer_summary",
				"previous_evidence_refs",
				"previous_tool_results",
				"session_state",
			},
			"runtime_only": []any{
				"schema_version",
				"conversation_id",
				"user_message_id",
				"parent_message_id",
				"memory_recall",
				"source_attribution",
				"budget",
				"truncation",
			},
		},
		"memory_recall":      map[string]any{"gate_field": "context.memory.enabled", "owner": "execution-control", "runtime": "hindsight"},
		"source_attribution": []any{},
		"context_summary":    nil,
		"budget":             map[string]any{"token_estimate": 320, "recent_turn_limit": 6},
		"truncation":         map[string]any{"reason": "recent_turn_limit"},
	})
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-context",
			"final_output":         "大一是否可申请需要看转专业办法的年级条件。",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "大一是否可申请需要看转专业办法的年级条件。"},
			"provider_response_id": "resp-primary-agent-context",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-context",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage":                map[string]any{"input_tokens": 12, "output_tokens": 8},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:context",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:       "conv-primary-agent-context",
		MemoryContext:        &temporalruntime.MemoryContext{ContextBlock: "用户记忆:\n- 用户偏好先看结论", MemoryRef: "projection://runs/run-primary-agent-context/memory/recall", SchemaVersion: "memory_recall_result_v1", SelectedMemoryChars: 18, SelectedMemoryCount: 1},
		MemoryProjectionRefs: []string{"projection://runs/run-primary-agent-context/memory/recall"},
		RequestID:            "req-primary-agent-context",
		RunID:                "run-primary-agent-context",
		TraceID:              "trace-executor-001",
		TurnID:               "turn-primary-agent-context",
		VisibleToolNames:     []string{"knowledge_query"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	finalModelContext, ok := seenBody["final_model_context"].(map[string]any)
	if !ok {
		t.Fatalf("agent runtime request missing final_model_context: %#v", seenBody)
	}
	if finalModelContext["schema_version"] != "final_model_context.v1" ||
		finalModelContext["current_user_message"] != "那大一能不能申请？" {
		t.Fatalf("final_model_context = %#v", finalModelContext)
	}
	usageSummary, ok := finalModelContext["usage_summary"].(map[string]any)
	if !ok || usageSummary["memory_recall_state"] != "completed" ||
		usageSummary["token_estimate"] != float64(320) ||
		usageSummary["truncation_reason"] != "recent_turn_limit" {
		t.Fatalf("usage_summary = %#v", finalModelContext["usage_summary"])
	}
	previousEvidence, ok := finalModelContext["previous_evidence"].([]any)
	if !ok || len(previousEvidence) != 1 {
		t.Fatalf("previous_evidence = %#v", finalModelContext["previous_evidence"])
	}
	firstEvidence, ok := previousEvidence[0].(map[string]any)
	if !ok || firstEvidence["evidence_id"] != "ev_transfer_rule_01" ||
		firstEvidence["content_hash"] != "sha256:transfer-major-evidence-example" {
		t.Fatalf("previous evidence = %#v", previousEvidence)
	}
	previousToolResults, ok := finalModelContext["previous_tool_results"].([]any)
	if !ok || len(previousToolResults) != 1 {
		t.Fatalf("previous_tool_results = %#v", finalModelContext["previous_tool_results"])
	}
	firstToolResult, ok := previousToolResults[0].(map[string]any)
	if !ok || firstToolResult["tool"] != "transport_schedule_lookup" ||
		firstToolResult["projection_ref"] != "projection://runs/run_previous_services/finalization" {
		t.Fatalf("previous tool result = %#v", previousToolResults)
	}
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-context")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 {
		t.Fatalf("steps = %#v", steps)
	}
	contextUsage, ok := steps[0].SanitizedPayload["context_usage"].(map[string]any)
	if !ok || contextUsage["schema_version"] != "final_model_context.v1" ||
		contextUsage["previous_evidence_count"] != 1 ||
		contextUsage["previous_tool_result_count"] != 1 {
		t.Fatalf("context_usage = %#v", steps[0].SanitizedPayload["context_usage"])
	}
}
