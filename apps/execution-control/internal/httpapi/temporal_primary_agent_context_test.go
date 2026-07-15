package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestPrimaryAgentContextBudgetDropsCategoriesInDeterministicOrder(t *testing.T) {
	contextPayload := map[string]any{
		"schema_version": "final_model_context.v2",
		"recent_turns": []any{
			map[string]any{"message_id": "msg-1", "role": "user", "content": strings.Repeat("旧问题", 30)},
			map[string]any{"message_id": "msg-2", "role": "assistant", "content": strings.Repeat("旧回答", 30)},
		},
		"previous_evidence": []any{
			map[string]any{
				"access_scope": "public_student_rule",
				"content_hash": "sha256:evidence",
				"evidence_id":  "evidence-1",
				"snippet":      "证据正文",
				"source_id":    "student-rules/source",
				"version_id":   "v2026",
			},
		},
		"previous_tool_results": []any{
			map[string]any{"projection_ref": "projection://one", "summary": strings.Repeat("旧工具结果", 30)},
			map[string]any{"projection_ref": "projection://two", "summary": strings.Repeat("旧工具结果", 30)},
		},
		"memory_context": map[string]any{
			"context_block": strings.Repeat("个人记忆", 30),
			"memory_ref":    "projection://memory",
		},
	}
	expected := deepCloneContextForTest(t, contextPayload)
	expected["previous_tool_results"] = []any{}
	delete(expected, "memory_context")
	limit, err := primaryAgentContextCharacterCount(expected)
	if err != nil {
		t.Fatalf("count expected context: %v", err)
	}

	first := cloneAnyMapFromMetadata(contextPayload)
	dropped, after, err := primaryAgentApplyContextBudget(first, limit)
	if err != nil {
		t.Fatalf("apply context budget: %v", err)
	}
	if !reflect.DeepEqual(first, expected) {
		t.Fatalf("truncated context = %#v, want %#v", first, expected)
	}
	if !reflect.DeepEqual(dropped, map[string]any{"memory_context": 1, "previous_tool_results": 2}) {
		t.Fatalf("dropped counts = %#v", dropped)
	}
	if after != limit {
		t.Fatalf("context chars after = %d, want %d", after, limit)
	}

	second := cloneAnyMapFromMetadata(contextPayload)
	secondDropped, secondAfter, err := primaryAgentApplyContextBudget(second, limit)
	if err != nil {
		t.Fatalf("apply context budget again: %v", err)
	}
	if !reflect.DeepEqual(second, first) || !reflect.DeepEqual(secondDropped, dropped) || secondAfter != after {
		t.Fatalf("context truncation is not deterministic")
	}
}

func TestPrimaryAgentContextBudgetDropsEvidenceSnippetButRetainsIdentity(t *testing.T) {
	contextPayload := map[string]any{
		"schema_version": "final_model_context.v2",
		"recent_turns": []any{
			map[string]any{"message_id": "msg-latest", "role": "user", "content": "上一轮问题"},
		},
		"previous_evidence": []any{
			map[string]any{
				"access_scope": "public_curriculum",
				"content_hash": "sha256:curriculum",
				"document_id":  "curriculum-computer-science",
				"evidence_id":  "evidence-curriculum-1",
				"snippet":      strings.Repeat("培养方案正文", 100),
				"source_id":    "curriculum/computer-science",
				"version_id":   "2026",
			},
		},
		"previous_tool_results": []any{},
	}
	expected := deepCloneContextForTest(t, contextPayload)
	expectedEvidence := anyListFromAny(expected["previous_evidence"])
	expectedItem := cloneAnyMapFromMetadata(expectedEvidence[0])
	delete(expectedItem, "snippet")
	expectedEvidence[0] = expectedItem
	expected["previous_evidence"] = expectedEvidence
	limit, err := primaryAgentContextCharacterCount(expected)
	if err != nil {
		t.Fatalf("count expected context: %v", err)
	}

	dropped, _, err := primaryAgentApplyContextBudget(contextPayload, limit)
	if err != nil {
		t.Fatalf("apply context budget: %v", err)
	}
	if !reflect.DeepEqual(dropped, map[string]any{"previous_evidence_snippets": 1}) {
		t.Fatalf("dropped counts = %#v", dropped)
	}
	evidence := cloneAnyMapFromMetadata(anyListFromAny(contextPayload["previous_evidence"])[0])
	if _, exists := evidence["snippet"]; exists {
		t.Fatalf("evidence snippet was not removed: %#v", evidence)
	}
	for key, want := range map[string]any{
		"access_scope": "public_curriculum",
		"content_hash": "sha256:curriculum",
		"document_id":  "curriculum-computer-science",
		"evidence_id":  "evidence-curriculum-1",
		"source_id":    "curriculum/computer-science",
		"version_id":   "2026",
	} {
		if evidence[key] != want {
			t.Fatalf("evidence %s = %#v, want %#v", key, evidence[key], want)
		}
	}
}

func deepCloneContextForTest(t *testing.T, value map[string]any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("encode context fixture: %v", err)
	}
	var cloned map[string]any
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		t.Fatalf("decode context fixture: %v", err)
	}
	return cloned
}

func TestPrimaryAgentFinalModelContextRejectsOversizedCurrentInput(t *testing.T) {
	run := execution.DurableRun{Metadata: map[string]any{
		"execution_payload": map[string]any{"user_goal": strings.Repeat("界", 8001)},
	}}
	_, err := primaryAgentFinalModelContextForRun(run, temporalruntime.ExecutePrimaryAgentActivityInput{}, primaryAgentRuntimeLimits{
		CurrentInputCharLimit: 8000,
		ContextCharLimit:      16000,
	})
	if err == nil || !strings.Contains(err.Error(), "8001 characters") {
		t.Fatalf("oversized input error = %v", err)
	}
}

func TestPrimaryAgentContextBudgetRejectsUntrimmableContext(t *testing.T) {
	contextPayload := map[string]any{
		"schema_version":        "final_model_context.v2",
		"recent_turns":          []any{},
		"previous_evidence":     []any{},
		"previous_tool_results": []any{},
		"session_state": map[string]any{
			"confirmed_slots": []any{map[string]any{
				"confirmed": true,
				"name":      "curriculum_program",
				"value":     strings.Repeat("计算机科学与技术", 100),
			}},
			"turn_count": 1,
		},
	}
	_, _, err := primaryAgentApplyContextBudget(contextPayload, 100)
	if err == nil || !strings.Contains(err.Error(), "after deterministic truncation") {
		t.Fatalf("untrimmable context error = %v", err)
	}
}

func TestExecutePrimaryAgentActivitySendsFinalModelContextFromConversationEnvelope(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 31, 0, 0, time.UTC)
	longAssistantTurn := strings.Repeat("转专业要求", 60)
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
				"message_id": "msg_user_000",
				"role":       "user",
				"content":    "最早一轮应被丢弃。",
			},
			map[string]any{
				"message_id": "msg_user_001",
				"role":       "user",
				"content":    "转专业条件是什么？",
			},
			map[string]any{
				"message_id": "msg_assistant_002",
				"role":       "assistant",
				"content":    "上一轮回答的是转专业申请条件。",
			},
			map[string]any{
				"message_id": "msg_user_003",
				"role":       "user",
				"content":    "名额有限制吗？",
			},
			map[string]any{
				"message_id": "msg_assistant_004",
				"role":       "assistant",
				"content":    "名额由学院公布。",
			},
			map[string]any{
				"message_id": "msg_user_005",
				"role":       "user",
				"content":    "成绩有什么要求？",
			},
			map[string]any{
				"message_id": "msg_assistant_006",
				"role":       "assistant",
				"content":    longAssistantTurn,
			},
			map[string]any{
				"message_id": "msg_user_007",
				"role":       "user",
				"content":    "还要学院审核吗？",
			},
		},
		"session_state": map[string]any{"confirmed_slots": []any{}, "turn_count": 2},
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
		AgentRuntimeDeadlineMS:   1000,
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
	if finalModelContext["schema_version"] != "final_model_context.v2" {
		t.Fatalf("final_model_context = %#v", finalModelContext)
	}
	if _, exists := finalModelContext["current_user_message"]; exists {
		t.Fatalf("final_model_context duplicates current_user_message: %#v", finalModelContext)
	}
	if _, exists := seenBody["memory_context"]; exists {
		t.Fatalf("agent runtime request duplicates memory_context: %#v", seenBody)
	}
	if _, exists := seenBody["memory_projection_refs"]; exists {
		t.Fatalf("agent runtime request exposes unused memory_projection_refs: %#v", seenBody)
	}
	usageSummary, ok := finalModelContext["usage_summary"].(map[string]any)
	if !ok || usageSummary["memory_recall_state"] != "completed" ||
		intFromAny(usageSummary["context_chars"]) <= 0 ||
		intFromAny(usageSummary["current_input_chars"]) != 9 {
		t.Fatalf("usage_summary = %#v", finalModelContext["usage_summary"])
	}
	if _, exists := usageSummary["token_estimate"]; exists {
		t.Fatalf("usage_summary contains retired token estimate: %#v", usageSummary)
	}
	recentTurns, ok := finalModelContext["recent_turns"].([]any)
	if !ok || len(recentTurns) != 8 {
		t.Fatalf("recent_turns = %#v", finalModelContext["recent_turns"])
	}
	firstRecentTurn, _ := recentTurns[0].(map[string]any)
	if firstRecentTurn["message_id"] != "msg_user_000" {
		t.Fatalf("recent_turn ordering = %#v", recentTurns)
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
	if !ok || contextUsage["schema_version"] != "final_model_context.v2" ||
		contextUsage["previous_evidence_count"] != 1 ||
		contextUsage["previous_tool_result_count"] != 1 ||
		intFromAny(contextUsage["context_chars"]) <= 0 {
		t.Fatalf("context_usage = %#v", steps[0].SanitizedPayload["context_usage"])
	}
}
