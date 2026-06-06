package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/temporalruntime"
)

type fakeTemporalStarter struct {
	cancelRunID  string
	cancelReason string
	cancelErr    error
	input        temporalruntime.ChatAnswerWorkflowInput
	err          error
}

func durableWorkerBridgeResponseForTest() bridge.ExecuteResponse {
	return bridge.ExecuteResponse{
		StatusCode: 200,
		Kind:       "durable_agent_response",
		Body:       durableAgentResponseBodyForTest("ok"),
	}
}

func (f *fakeTemporalStarter) StartChatAnswerWorkflow(
	_ context.Context,
	input temporalruntime.ChatAnswerWorkflowInput,
) error {
	f.input = input
	return f.err
}

func (f *fakeTemporalStarter) CancelChatAnswerWorkflow(
	_ context.Context,
	input temporalruntime.ChatAnswerWorkflowCancelInput,
) error {
	f.cancelRunID = input.RunID
	f.cancelReason = input.Reason
	return f.cancelErr
}

func TestExecutionRunCreateQueuesProjectionAndStartsTemporalWorkflow(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{}
	server := NewServer(config.Config{
		WorkerSharedSecret:     "secret",
		RequestBodyLimitBytes:  1_048_576,
		MaxConcurrentAnswers:   8,
		TemporalNamespace:      "campus-agent-test",
		TemporalTaskQueue:      temporalruntime.WorkflowTaskQueue,
		TemporalWorkflowIDSalt: "test-salt",
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(`{
			"run_id":"run-temporal-001",
			"conversation_id":"conv-temporal-001",
			"turn_id":"turn-temporal-001",
			"request_id":"req-temporal-001",
			"trace_id":"trace-temporal-001",
			"owner_user_id":"user-temporal-001",
			"surface":"public-chat-web",
			"requested_capability":"knowledge",
			"selected_capability":"knowledge",
			"lane":"rag",
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"user_goal":"hello",
					"request_id":"req-temporal-001",
					"conversation_id":"conv-temporal-001",
					"trace":{"trace_id":"trace-temporal-001"},
					"runtime_decisions":{"runtime_decision_summary":{}}
				},
				"handoff":{
					"target":"rag-tool",
					"payload_kind":"rag_request",
					"allowed_tools":["retrieval.query"],
					"payload":{"query_text":"hello"}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	run, err := store.GetRun(context.Background(), "run-temporal-001")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("projection status = %q, want queued", run.Status)
	}
	if starter.input.RunID != "run-temporal-001" {
		t.Fatalf("workflow input run id = %q", starter.input.RunID)
	}
	if starter.input.WorkflowID != "campus-agent.chat.run-temporal-001" {
		t.Fatalf("workflow id = %q", starter.input.WorkflowID)
	}
	if starter.input.PayloadSHA256 == "" {
		t.Fatal("workflow input payload hash is required")
	}
	if strings.Contains(starter.input.PayloadSHA256, "hello") {
		t.Fatalf("workflow payload hash must not contain raw prompt: %q", starter.input.PayloadSHA256)
	}
}

func TestExecutionRunCreateFailsClosedWhenTemporalStarterMissing(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-missing", "conv-temporal-missing")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "temporal_runtime_not_configured")
}

func TestExecutionRunCreateFailsClosedWhenTemporalStartFails(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{err: context.DeadlineExceeded}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-fail", "conv-temporal-fail")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "temporal_workflow_start_failed")
	if _, err := store.GetRun(context.Background(), "run-temporal-fail"); err == nil {
		t.Fatal("failed Temporal start must not leave an admitted run projection")
	}
}

func TestExecutionRunCancelDelegatesToTemporalCancellation(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-cancel",
		"conv-temporal-cancel",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-temporal-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.cancelRunID != "run-temporal-cancel" {
		t.Fatalf("Temporal cancel run id = %q, want run-temporal-cancel", starter.cancelRunID)
	}
	if starter.cancelReason != "user_requested" {
		t.Fatalf("Temporal cancel reason = %q, want user_requested", starter.cancelReason)
	}
}

func TestExecutionRunCancelFailsClosedWhenTemporalCancelFails(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{cancelErr: context.DeadlineExceeded}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-cancel-fail",
		"conv-temporal-cancel-fail",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-temporal-cancel-fail/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "temporal_workflow_cancel_failed")
	run, err := store.GetRun(context.Background(), "run-temporal-cancel-fail")
	if err != nil {
		t.Fatalf("get run after failed cancel: %v", err)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		t.Fatal("failed Temporal cancel must not mark projection canceled")
	}
}

func TestInvokeSemanticWorkerActivityStopsWhenProjectionAlreadyCanceled(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			t.Fatal("canceled projection must not invoke semantic bridge")
			return bridge.ExecuteResponse{}, nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-already-canceled",
		"conv-temporal-already-canceled",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.CancelRun(context.Background(), execution.DurableRunCancelRequest{
		RunID:         "run-temporal-already-canceled",
		Reason:        "user_requested",
		Now:           now.Add(time.Second),
		ReleaseReason: string(execution.DurableTerminalReasonUserCanceled),
	}); err != nil {
		t.Fatalf("cancel run setup: %v", err)
	}

	_, err := server.InvokeSemanticWorkerActivity(context.Background(), temporalruntime.InvokeSemanticWorkerActivityInput{
		PlanRef: "projection://runs/run-temporal-already-canceled/plan",
		RunID:   "run-temporal-already-canceled",
		TraceID: "trace-run-temporal-already-canceled",
	})

	if err == nil {
		t.Fatal("canceled projection must fail activity closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-temporal-already-canceled")
	if getErr != nil {
		t.Fatalf("get run after activity: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
}

func TestTemporalActivitiesProjectTypedStepEvents(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:               500,
		TemporalNamespace:             "campus-agent-test",
		TemporalWorkerIdentity:        "test:rag:worker",
		TemporalWorkflowIDSalt:        "test-salt",
		RequestBodyLimitBytes:         1_048_576,
		WorkerSharedSecret:            "secret",
		MaxConcurrentAnswers:          8,
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-steps",
		"conv-temporal-steps",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.AppendRunEvent(context.Background(), execution.DurableRunEvent{
		EventID:              "run-temporal-steps:run-queued",
		RunID:                "run-temporal-steps",
		ConversationID:       "conv-temporal-steps",
		EventType:            execution.DurableRunEventTypeRunQueued,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(execution.DurableRunStatusQueued)},
	}); err != nil {
		t.Fatalf("append queued event setup: %v", err)
	}

	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-steps",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-steps",
		RunID:          "run-temporal-steps",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-steps",
		WorkflowID:     "campus-agent.chat.run-temporal-steps",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-steps",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}
	finalization, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-steps",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("finalization activity: %v", err)
	}
	if finalization.ProjectionRef != "projection://runs/run-temporal-steps/finalization" {
		t.Fatalf("projection ref = %q", finalization.ProjectionRef)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-steps")
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunQueued,
		execution.DurableRunEventTypeWorkflowPlanned,
		execution.DurableRunEventTypeActivityStarted,
		execution.DurableRunEventTypeActivityCompleted,
		execution.DurableRunEventTypeFinalizationCompleted,
		execution.DurableRunEventTypeRunCompleted,
	})
}

func TestAppendTemporalRunEventAcceptsIdenticalRetryProjection(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-event-retry",
		"conv-temporal-event-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	event := execution.DurableRunEvent{
		EventID:              "run-temporal-event-retry:workflow-planned",
		RunID:                "run-temporal-event-retry",
		ConversationID:       "conv-temporal-event-retry",
		EventType:            execution.DurableRunEventTypeWorkflowPlanned,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"workflow_id": "campus-agent.chat.run-temporal-event-retry"},
	}
	if err := server.appendTemporalRunEvent(context.Background(), event); err != nil {
		t.Fatalf("append first event: %v", err)
	}
	if err := server.appendTemporalRunEvent(context.Background(), event); err != nil {
		t.Fatalf("append identical retry event: %v", err)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-event-retry")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("event count = %d, want 1", len(events))
	}
}

func TestFinalizeChatAnswerActivityReturnsCompletedProjectionOnRetry(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:finalization:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-finalize-retry",
		"conv-temporal-finalize-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-finalize-retry",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-finalize-retry",
		RunID:          "run-temporal-finalize-retry",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-finalize-retry",
		WorkflowID:     "campus-agent.chat.run-temporal-finalize-retry",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-finalize-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}
	first, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-finalize-retry",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("first finalization activity: %v", err)
	}
	second, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-finalize-retry",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retry finalization activity: %v", err)
	}
	if second.ProjectionRef != first.ProjectionRef || second.Status != "completed" {
		t.Fatalf("retry finalization result = %#v, first = %#v", second, first)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-finalize-retry")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var completedCount int
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted {
			completedCount++
		}
	}
	if completedCount != 1 {
		t.Fatalf("run.completed count = %d, want 1", completedCount)
	}
}

func TestInvokeSemanticWorkerActivityReturnsStoredProjectionOnRetry(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	var bridgeCalls int
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-semantic-retry",
		"conv-temporal-semantic-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-semantic-retry",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-semantic-retry",
		RunID:          "run-temporal-semantic-retry",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-semantic-retry",
		WorkflowID:     "campus-agent.chat.run-temporal-semantic-retry",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	first, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-semantic-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("first semantic activity: %v", err)
	}
	second, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-semantic-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retry semantic activity: %v", err)
	}
	if second.BridgeRef != first.BridgeRef || second.Status != "completed" {
		t.Fatalf("retry semantic result = %#v, first = %#v", second, first)
	}
	if bridgeCalls != 1 {
		t.Fatalf("semantic bridge calls = %d, want 1", bridgeCalls)
	}
}
