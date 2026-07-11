package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
)

func TestExecutionRunCancelEmitsSafeExecutionAuditEvents(t *testing.T) {
	received := make(chan map[string]any, 2)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("x-app-internal-auth") != "audit-secret" {
			t.Fatalf("x-app-internal-auth = %q, want audit-secret", request.Header.Get("x-app-internal-auth"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	server.executionAudit = executionaudit.NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-audit-cancel",
		"conv-audit-cancel",
		now,
		ragHandoffForDurableWorkerTest("raw user goal must not be emitted"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-audit-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	events := collectAuditEvents(t, received, 2)
	eventTypes := map[string]map[string]any{}
	for _, event := range events {
		eventTypes[stringValue(event["event_type"])] = event
	}
	cancelRequested := eventTypes["execution.cancel_requested"]
	if cancelRequested == nil {
		t.Fatalf("missing execution.cancel_requested in events: %#v", events)
	}
	cancelled := eventTypes["execution.cancelled"]
	if cancelled == nil {
		t.Fatalf("missing execution.cancelled in events: %#v", events)
	}
	for _, event := range []map[string]any{cancelRequested, cancelled} {
		if event["request_id"] != "req-executor-001" || event["trace_id"] != "trace-executor-001" {
			t.Fatalf("audit identity = %#v", event)
		}
		if event["requested_tool"] != "knowledge_query" || event["task_queue"] != "campus-agent.workflow" {
			t.Fatalf("audit routing summary = %#v", event)
		}
		assertAuditEventDoesNotLeakRawPayload(t, event)
	}
	if cancelled["decision"] != "user_requested" || cancelled["retryable"] != false {
		t.Fatalf("cancelled audit payload = %#v", cancelled)
	}
}

func TestFailTemporalRunEmitsActivityFailureAuditEvent(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	server.executionAudit = executionaudit.NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-audit-failure",
		"conv-audit-failure",
		now,
		ragHandoffForDurableWorkerTest("raw prompt must stay out"),
	)
	run, err := store.GetRun(context.Background(), "run-audit-failure")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	_, failureErr := server.failTemporalRunStep(
		context.Background(),
		run,
		temporalStepFailureProjection{
			FailureKind:   "knowledge_search_failed",
			ProjectionRef: temporalProjectionRef(run.RunID, "knowledge/search/search-1"),
			ResultKind:    "activity_failure",
			StepID:        "knowledge.search.search-1",
			StepKind:      "retrieval",
			TaskQueue:     "campus-agent.activity.agent",
			Tool:          "knowledge_search",
			Payload: map[string]any{
				"failure_kind": "knowledge_search_failed",
				"user_goal":    "raw prompt must stay out",
			},
		},
		errors.New("lookup failed"),
	)

	if failureErr == nil {
		t.Fatal("expected terminal projection error")
	}
	event := collectAuditEvents(t, received, 1)[0]
	if event["event_type"] != "execution.activity_failed" ||
		event["failure_kind"] != "knowledge_search_failed" ||
		event["request_id"] != "req-executor-001" ||
		event["trace_id"] != "trace-executor-001" ||
		event["retryable"] != false {
		t.Fatalf("unexpected audit event: %#v", event)
	}
	assertAuditEventDoesNotLeakRawPayload(t, event)
}

func TestFailTemporalRunEmitsAgentProviderTimeoutAuditEvent(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	server.executionAudit = executionaudit.NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-audit-timeout",
		"conv-audit-timeout",
		now,
		ragHandoffForDurableWorkerTest("raw prompt must stay out"),
	)
	run, err := store.GetRun(context.Background(), "run-audit-timeout")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	_, failureErr := server.failTemporalRunStep(
		context.Background(),
		run,
		temporalStepFailureProjection{
			FailureKind:    "agent_runtime_failed",
			ProjectionRef:  temporalProjectionRef(run.RunID, "agent/primary/result"),
			ResultKind:     "provider_execution_summary",
			StepID:         "agent.primary",
			StepKind:       "agent",
			TaskQueue:      "campus-agent.activity.agent",
			TimeoutOutcome: execution.TimeoutOutcomeProviderTimeout,
			Tool:           "knowledge_query",
		},
		context.DeadlineExceeded,
	)

	if failureErr == nil {
		t.Fatal("expected terminal projection error")
	}
	event := collectAuditEvents(t, received, 1)[0]
	if event["event_type"] != "execution.timed_out" ||
		event["failure_kind"] != "agent_runtime_failed" {
		t.Fatalf("unexpected timeout audit event: %#v", event)
	}
	assertAuditEventDoesNotLeakRawPayload(t, event)
}

func collectAuditEvents(
	t *testing.T,
	received <-chan map[string]any,
	expectedCount int,
) []map[string]any {
	t.Helper()
	events := make([]map[string]any, 0, expectedCount)
	for len(events) < expectedCount {
		select {
		case body := <-received:
			items, ok := body["events"].([]any)
			if !ok {
				t.Fatalf("events = %#v, want array", body["events"])
			}
			for _, item := range items {
				event, ok := item.(map[string]any)
				if !ok {
					t.Fatalf("event = %#v, want object", item)
				}
				events = append(events, event)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for %d audit events; received %d", expectedCount, len(events))
		}
	}
	return events
}

func assertAuditEventDoesNotLeakRawPayload(t *testing.T, event map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("encode audit event: %v", err)
	}
	for _, forbidden := range []string{
		"raw prompt",
		"raw user goal",
		"user_goal",
		"raw_prompt",
		"prompt",
		"transcript",
		"retrieval_payload",
		"authorization",
	} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("audit event leaked forbidden payload %q: %s", forbidden, encoded)
		}
	}
}
