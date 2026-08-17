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

func TestPrimaryAgentConversationContextRejectsOversizedCurrentInput(t *testing.T) {
	payload := map[string]any{"user_goal": strings.Repeat("界", 8001)}
	_, err := primaryAgentConversationContextForRun(payload, primaryAgentRuntimeLimits{
		CurrentInputCharLimit: 8000,
	})
	if err == nil || !strings.Contains(err.Error(), "8001 characters") {
		t.Fatalf("oversized input error = %v", err)
	}
}

func TestPrimaryAgentConversationContextKeepsOnlyModelRelevantConversationFields(t *testing.T) {
	payload := map[string]any{
		"user_goal": "那大一能不能申请？",
		"context": map[string]any{
			"conversation": map[string]any{
				"recent_turns": []any{
					map[string]any{
						"message_id": "msg_user_001",
						"role":       "user",
						"content":    "转专业条件是什么？",
						"created_at": "2026-06-12T10:30:00Z",
					},
					map[string]any{"role": "tool", "content": "internal result"},
					map[string]any{"role": "assistant", "content": "上一轮回答。"},
				},
				"session_state": map[string]any{
					"confirmed_slots": []any{
						map[string]any{
							"confirmed": true,
							"name":      "curriculum_program",
							"value":     "计算机科学与技术",
						},
						map[string]any{
							"confirmed": false,
							"name":      "grade",
							"value":     "大一",
						},
					},
					"turn_count": 2,
				},
			},
		},
	}

	contextValue, err := primaryAgentConversationContextForRun(payload, primaryAgentRuntimeLimits{
		CurrentInputCharLimit: 8000,
	})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"schema_version": "agent_conversation_context.v1",
		"recent_turns": []any{
			map[string]any{
				"message_id": "msg_user_001",
				"role":       "user",
				"content":    "转专业条件是什么？",
			},
			map[string]any{"role": "assistant", "content": "上一轮回答。"},
		},
		"session_state": map[string]any{
			"confirmed_slots": []any{
				map[string]any{
					"confirmed": true,
					"name":      "curriculum_program",
					"value":     "计算机科学与技术",
				},
			},
		},
	}
	if !reflect.DeepEqual(contextValue, want) {
		t.Fatalf("conversation context = %#v, want %#v", contextValue, want)
	}
}

func TestExecutePrimaryAgentActivitySendsConversationContextAndProjectsRuntimeUsage(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 31, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-context",
		"conv-primary-agent-context",
		now,
		agentRequestForDurableWorkerTest("那大一能不能申请？"),
	)
	setExecutionPayloadConversationContextForRunTest(t, store, "run-primary-agent-context", map[string]any{
		"recent_turns": []any{
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
		},
		"session_state": map[string]any{"confirmed_slots": []any{}},
	})
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":       "completed",
			"run_id":       "run-primary-agent-context",
			"final_output": "当前证据不足。",
			"context_usage": map[string]any{
				"context_chars":            320,
				"current_input_chars":      9,
				"model_visible_item_count": 4,
			},
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"terminal_envelope":    map[string]any{"kind": "unsupported_by_evidence", "answer_text": "当前证据不足。"},
			"provider_response_id": "resp-primary-agent-context",
			"tool_results":         []any{},
			"terminal_reason":      "unsupported_by_evidence",
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
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-context",
		RequestID:        "req-primary-agent-context",
		RunID:            "run-primary-agent-context",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-context",
		VisibleToolNames: []string{},
	})
	output, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	conversationContext, ok := seenBody["conversation_context"].(map[string]any)
	if !ok || conversationContext["schema_version"] != "agent_conversation_context.v1" {
		t.Fatalf("agent runtime request missing conversation context: %#v", seenBody)
	}
	if _, exists := conversationContext["current_user_message"]; exists {
		t.Fatalf("conversation context duplicates current input: %#v", conversationContext)
	}
	if _, exists := conversationContext["usage_summary"]; exists {
		t.Fatalf("execution-control must not precompute model context usage: %#v", conversationContext)
	}
	if output.ContextUsage["context_chars"] != float64(320) {
		t.Fatalf("runtime context usage = %#v", output.ContextUsage)
	}
}
