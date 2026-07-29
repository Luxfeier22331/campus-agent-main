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
	"go.temporal.io/sdk/temporal"
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

func TestExecutePrimaryAgentActivityRepairsCompletedReceiptWithoutSecondModelCall(t *testing.T) {
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
				agentRequestForDurableWorkerTest("今晚六点还有班车吗"),
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
					"run_id":               runID,
					"final_output":         "已完成。",
					"model_name":           "gpt-test",
					"model_provider":       "openai",
					"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "已完成。"},
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
						"arguments_json": map[string]any{"query": "今晚六点还有班车吗"},
						"result_ref":     "agent-runtime://" + runID + "/tools/personal_memory_recall/1",
						"result": map[string]any{
							"outcome": "matched", "memory_text": "用户经常乘坐晚班车。",
						},
					}}
				}
				writeAgentRuntimeSSEEvent(t, response, "completed", payload)
			}))
			t.Cleanup(agentRuntime.Close)
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
				RequestID:        "req-executor-001",
				RunID:            runID,
				TraceID:          "trace-executor-001",
				TurnID:           "turn-" + runID,
				VisibleToolNames: []string{personalMemoryRecallToolName},
			})

			if _, err := server.ExecutePrimaryAgentActivity(context.Background(), input); err == nil {
				t.Fatal("first Activity unexpectedly crossed the injected projection failure")
			}
			if calls.Load() != 1 {
				t.Fatalf("agent runtime calls after first attempt = %d, want 1", calls.Load())
			}

			// Completed receipt recovery must not consult mutable/external admission
			// dependencies or the original App API execution input.
			testExecutionInputs.Lock()
			delete(testExecutionInputs.values, runID)
			testExecutionInputs.Unlock()
			server.providerConfigResolver = nil
			agentRuntime.Close()

			output, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
			if err != nil {
				t.Fatalf("repair completed receipt: %v", err)
			}
			if output.Status != "completed" || calls.Load() != 1 {
				t.Fatalf("repair output=%#v agent runtime calls=%d", output, calls.Load())
			}
			assertAgentReceiptProjectionConverged(t, baseStore, runID, test.withTool)
		})
	}
}

func assertAgentReceiptProjectionConverged(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	wantTool bool,
) {
	t.Helper()
	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list repaired steps: %v", err)
	}
	completed := map[string]bool{}
	for _, step := range steps {
		if step.Status == "completed" {
			completed[step.StepID] = true
		}
	}
	if !completed["agent.primary"] {
		t.Fatalf("repaired agent.primary step missing: %#v", steps)
	}
	if wantTool && !completed["sdk_tool.execute.personal_memory_recall.1"] {
		t.Fatalf("repaired SDK tool step missing: %#v", steps)
	}
	if wantTool {
		assertSDKToolAttemptDuration(
			t,
			store,
			runID,
			"sdk_tool.execute.personal_memory_recall.1",
			18,
		)
	}
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list repaired results: %v", err)
	}
	wantResults := 1
	if wantTool {
		wantResults = 2
	}
	if len(results) != wantResults {
		t.Fatalf("repaired results = %#v, want %d", results, wantResults)
	}
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list repaired events: %v", err)
	}
	agentCompleted := 0
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeAgentCompleted {
			agentCompleted++
		}
	}
	if agentCompleted != 1 {
		t.Fatalf("agent.completed event count = %d, want 1", agentCompleted)
	}
}

type tamperedAgentReceiptStore struct {
	*execution.InMemoryRunProjectionStore
	hideReceipt       bool
	mutateReceipt     func(execution.AgentInvocationReceipt) execution.AgentInvocationReceipt
	mutateStepResults func([]execution.StepResultProjection) []execution.StepResultProjection
	tamperResultHash  bool
}

func (s *tamperedAgentReceiptStore) GetAgentInvocationReceipt(
	ctx context.Context,
	invocationID string,
) (execution.AgentInvocationReceipt, error) {
	if s.hideReceipt {
		return execution.AgentInvocationReceipt{}, execution.ErrAgentInvocationNotFound
	}
	receipt, err := s.InMemoryRunProjectionStore.GetAgentInvocationReceipt(ctx, invocationID)
	if err == nil && s.mutateReceipt != nil {
		receipt = s.mutateReceipt(receipt)
	}
	return receipt, err
}

func (s *tamperedAgentReceiptStore) ListStepResults(
	ctx context.Context,
	runID string,
) ([]execution.StepResultProjection, error) {
	results, err := s.InMemoryRunProjectionStore.ListStepResults(ctx, runID)
	if err == nil && s.mutateStepResults != nil {
		results = s.mutateStepResults(results)
	}
	return results, err
}

func (s *tamperedAgentReceiptStore) GetProtectedPayload(
	ctx context.Context,
	runID string,
	payloadRef string,
	kind string,
) (execution.ProtectedPayload, error) {
	payload, err := s.InMemoryRunProjectionStore.GetProtectedPayload(ctx, runID, payloadRef, kind)
	if err == nil && s.tamperResultHash && kind == protectedPayloadKindAgentResult {
		payload.PayloadSHA256 = strings.Repeat("0", 64)
	}
	return payload, err
}

func TestExecutePrimaryAgentActivityFailsClosedOnTamperedCompletedReceipt(t *testing.T) {
	tests := []struct {
		name             string
		mutateReceipt    func(execution.AgentInvocationReceipt) execution.AgentInvocationReceipt
		tamperResultHash bool
	}{
		{
			name: "receipt provider invocation hash",
			mutateReceipt: func(receipt execution.AgentInvocationReceipt) execution.AgentInvocationReceipt {
				receipt.InputSHA256 = strings.Repeat("0", 64)
				return receipt
			},
		},
		{
			name: "receipt output hash",
			mutateReceipt: func(receipt execution.AgentInvocationReceipt) execution.AgentInvocationReceipt {
				receipt.OutputSHA256 = strings.Repeat("0", 64)
				return receipt
			},
		},
		{
			name: "receipt result ref",
			mutateReceipt: func(receipt execution.AgentInvocationReceipt) execution.AgentInvocationReceipt {
				var summary agentInvocationOutputSummary
				if err := json.Unmarshal(receipt.OutputJSON, &summary); err != nil {
					panic(err)
				}
				summary.ResultRef = "projection://runs/other/agent/primary/result"
				receipt.OutputJSON, _ = json.Marshal(summary)
				receipt.OutputSHA256 = sha256Bytes(receipt.OutputJSON)
				return receipt
			},
		},
		{name: "protected result hash", tamperResultHash: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runID := "run-agent-tamper-" + strings.ReplaceAll(test.name, " ", "-")
			baseStore := execution.NewInMemoryRunProjectionStore()
			createHTTPAPIQueuedDurableRunForTest(
				t,
				baseStore,
				runID,
				"conv-"+runID,
				time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC),
				nil,
			)
			var calls atomic.Int32
			agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
					"status": "completed", "run_id": runID, "final_output": "ok",
					"model_name": "gpt-test", "model_provider": "openai",
					"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "ok"},
					"provider_response_id": "resp-" + runID,
					"tool_results":         []any{}, "terminal_reason": "answer_completed",
					"usage": map[string]any{"input_tokens": 1, "output_tokens": 1, "cached_input_tokens": 0},
				})
			}))
			t.Cleanup(agentRuntime.Close)
			server := NewServer(config.Config{
				AgentRuntimeBaseURL: agentRuntime.URL, AgentRuntimeSharedSecret: "agent-secret",
				AgentRuntimeDeadlineMS: 1000, TemporalWorkerIdentity: "test:agent:tamper",
			})
			attachAgentAdmissionProviderConfigsForTest(server)
			attachRunProjectionStoreForHandlerTest(server, baseStore)
			input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
				ConversationID: "conv-" + runID, RequestID: "req-executor-001", RunID: runID,
				TraceID: "trace-executor-001", TurnID: "turn-" + runID,
			})
			if _, err := server.ExecutePrimaryAgentActivity(context.Background(), input); err != nil {
				t.Fatalf("seed completed receipt: %v", err)
			}
			server.runProjectionStore = &tamperedAgentReceiptStore{
				InMemoryRunProjectionStore: baseStore,
				mutateReceipt:              test.mutateReceipt,
				tamperResultHash:           test.tamperResultHash,
			}
			_, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
			var applicationError *temporal.ApplicationError
			if !errors.As(err, &applicationError) || !applicationError.NonRetryable() ||
				applicationError.Type() != "agent_invocation_receipt_invalid" {
				t.Fatalf("tampered receipt error = %v, want non-retryable integrity failure", err)
			}
			if calls.Load() != 1 {
				t.Fatalf("agent runtime calls after tamper = %d, want 1", calls.Load())
			}
		})
	}
}
