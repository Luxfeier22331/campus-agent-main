package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type agentReceiptFailOnceStore struct {
	*execution.InMemoryRunProjectionStore
	failAgentEvent bool
	failToolResult bool
}

func (s *agentReceiptFailOnceStore) AppendRunEvent(
	ctx context.Context,
	event execution.DurableRunEvent,
) (execution.DurableRunEvent, error) {
	if s.failAgentEvent && event.EventType == execution.DurableRunEventTypeAgentCompleted {
		s.failAgentEvent = false
		return execution.DurableRunEvent{}, errors.New("injected agent completion event failure")
	}
	return s.InMemoryRunProjectionStore.AppendRunEvent(ctx, event)
}

func (s *agentReceiptFailOnceStore) UpsertStepResult(
	ctx context.Context,
	result execution.StepResultProjection,
) (execution.StepResultProjection, error) {
	if s.failToolResult && strings.HasPrefix(result.StepID, "sdk_tool.execute.") {
		s.failToolResult = false
		return execution.StepResultProjection{}, errors.New("injected SDK tool result failure")
	}
	return s.InMemoryRunProjectionStore.UpsertStepResult(ctx, result)
}

func TestExecutePrimaryAgentActivityFailsClosedAfterCompletedReceiptWithoutSecondModelCall(t *testing.T) {
	tests := []struct {
		name           string
		failAgentEvent bool
		failToolResult bool
		withTool       bool
	}{
		{name: "tool result projection", failToolResult: true, withTool: true},
		{name: "agent completed event", failAgentEvent: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runID := "run-agent-receipt-" + strings.ReplaceAll(test.name, " ", "-")
			baseStore := execution.NewInMemoryRunProjectionStore()
			createHTTPAPIQueuedDurableRunForTest(
				t,
				baseStore,
				runID,
				"conv-"+runID,
				time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC),
				agentRequestForDurableWorkerTest("今晚六点还有通知吗"),
			)
			store := &agentReceiptFailOnceStore{
				InMemoryRunProjectionStore: baseStore,
				failAgentEvent:             test.failAgentEvent,
				failToolResult:             test.failToolResult,
			}
			var calls atomic.Int32
			agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				payload := map[string]any{
					"status":               "completed",
					"request_id":           runID,
					"final_output":         "已完成。",
					"model_name":           "gpt-test",
					"model_provider":       "openai",
					"provider_response_id": "resp-" + runID,
					"tool_results":         []any{},
					"terminal_reason":      "answer_completed",
					"usage": map[string]any{
						"input_tokens": 4, "output_tokens": 2, "cached_input_tokens": 0,
					},
				}
				if test.withTool {
					payload["tool_results"] = []map[string]any{{
						"duration_ms":    17.25,
						"status":         "completed",
						"tool_name":      personalMemoryRecallToolName,
						"payload_kind":   personalMemoryRecallToolName,
						"arguments_json": map[string]any{"query": "今晚六点还有通知吗"},
						"result_ref":     "agent-runtime://" + runID + "/tools/personal_memory_recall/1",
						"result": map[string]any{
							"outcome": "matched", "memory_text": "用户经常乘坐晚通知。",
						},
					}}
				}
				writeAgentRuntimeSSEEvent(t, response, "completed", payload)
			}))
			defer agentRuntime.Close()
			server := NewServer(config.Config{
				AgentRuntimeBaseURL:      agentRuntime.URL,
				AgentRuntimeSharedSecret: "agent-secret",
				AgentRuntimeDeadlineMS:   1000,
				TemporalWorkerIdentity:   "test:agent:receipt",
			})
			attachAgentAdmissionProviderConfigsForTest(server)
			attachRunProjectionStoreForHandlerTest(server, store)
			input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
				ConversationID:   "conv-" + runID,
				RequestID:        runID,
				VisibleToolNames: []string{personalMemoryRecallToolName},
			})

			if _, err := server.ExecutePrimaryAgent(context.Background(), input); err == nil {
				t.Fatal("first Activity unexpectedly crossed the injected projection failure")
			}
			if calls.Load() != 1 {
				t.Fatalf("agent runtime calls after first attempt = %d, want 1", calls.Load())
			}

			_, err := server.ExecutePrimaryAgent(context.Background(), input)
			assertTemporalFailureSanitized(t, err, "agent_attempt_uncertain", true)
			if calls.Load() != 1 {
				t.Fatalf("agent runtime calls after completed receipt = %d, want 1", calls.Load())
			}
		})
	}
}

func TestExecutePrimaryAgentActivityReceiptStoresNoModelResult(t *testing.T) {
	runID := "run-agent-receipt-summary"
	store := execution.NewInMemoryRunProjectionStore()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-"+runID,
		time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC),
		nil,
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status": "completed", "request_id": runID, "final_output": "only-in-temporal-history",
			"model_name": "gpt-test", "model_provider": "openai",
			"provider_response_id": "resp-" + runID,
			"tool_results":         []any{}, "terminal_reason": "answer_completed",
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1, "cached_input_tokens": 0},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL: agentRuntime.URL, AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS: 1000, TemporalWorkerIdentity: "test:agent:receipt-summary",
	})
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID: "conv-" + runID, RequestID: runID,
	})
	if _, err := server.ExecutePrimaryAgent(context.Background(), input); err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	receipt, err := store.GetAgentInvocationReceipt(context.Background(), runID+":agent.primary")
	if err != nil {
		t.Fatalf("get receipt: %v", err)
	}
	if strings.Contains(string(receipt.OutputJSON), "only-in-temporal-history") {
		t.Fatalf("receipt contains model result: %s", receipt.OutputJSON)
	}
	var summary agentInvocationOutputSummary
	if err := json.Unmarshal(receipt.OutputJSON, &summary); err != nil ||
		summary.SchemaVersion != agentInvocationReceiptSchemaVersion ||
		summary.ResultRef != temporalProjectionRef(runID, "agent/primary/result") {
		t.Fatalf("receipt summary = %#v, err=%v", summary, err)
	}
}
