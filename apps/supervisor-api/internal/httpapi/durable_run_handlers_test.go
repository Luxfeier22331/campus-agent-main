package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestDurableRunCreateRequiresInternalWorkerAuth(t *testing.T) {
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	server.durableRuntime = execution.NewInMemoryDurableRuntimeStore()

	response := httptest.NewRecorder()
	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/internal/durable/runs", strings.NewReader(`{}`)),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestDurableRunCreateQueuesRunAndAppendsInitialEvents(t *testing.T) {
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
		"/internal/durable/runs",
		strings.NewReader(`{
			"run_id":"run-http-001",
			"conversation_id":"conv-http-001",
			"turn_id":"turn-http-001",
			"request_id":"req-http-001",
			"trace_id":"trace-http-001",
			"owner_user_id":"user-http-001",
			"surface":"public-chat-web",
			"requested_capability":"knowledge",
			"selected_capability":"knowledge",
			"lane":"rag",
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"user_goal":"hello",
					"request_id":"req-http-001",
					"conversation_id":"conv-http-001",
					"trace":{"trace_id":"trace-http-001"},
					"runtime_decisions":{"runtime_decision_summary":{}}
				},
				"handoff":{
					"target":"rag-agent",
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
	body := decodeBody(t, response)
	if body["run_id"] != "run-http-001" {
		t.Fatalf("run_id = %v", body["run_id"])
	}
	if body["status"] != "queued" {
		t.Fatalf("status = %v, want queued", body["status"])
	}
	run, err := store.GetRun(request.Context(), "run-http-001")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("stored status = %q, want queued", run.Status)
	}
	events, err := store.ListRunEvents(request.Context(), "run-http-001")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunCreated,
		execution.DurableRunEventTypeRunQueued,
	})
}

func TestDurableRunCreateRejectsActiveConversationRun(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)

	first := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-active-001", "conv-active-001")),
	)
	first.Header.Set("x-worker-origin-auth", "secret")
	firstResponse := httptest.NewRecorder()
	server.ServeHTTP(firstResponse, first)
	if firstResponse.Code != http.StatusAccepted {
		t.Fatalf("first status = %d; body: %s", firstResponse.Code, firstResponse.Body.String())
	}

	second := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-active-002", "conv-active-001")),
	)
	second.Header.Set("x-worker-origin-auth", "secret")
	secondResponse := httptest.NewRecorder()
	server.ServeHTTP(secondResponse, second)

	assertError(t, secondResponse, http.StatusConflict, "conversation_active_run")
}

func TestDurableRunCreateRejectsMissingExecutionPayload(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)

	request := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(`{
			"run_id":"run-metadata-001",
			"conversation_id":"conv-metadata-001",
			"turn_id":"turn-metadata-001",
			"request_id":"req-metadata-001",
			"owner_user_id":"user-http-001",
			"surface":"public-chat-web",
			"lane":"rag",
			"metadata":{}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if !strings.Contains(response.Body.String(), "metadata.execution_payload is required") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestDurableRunCreateRejectsExecutionPayloadIdentityMismatch(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)

	request := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(`{
			"run_id":"run-metadata-002",
			"conversation_id":"conv-metadata-002",
			"turn_id":"turn-metadata-002",
			"request_id":"req-metadata-002",
			"trace_id":"trace-metadata-002",
			"owner_user_id":"user-http-001",
			"surface":"public-chat-web",
			"lane":"rag",
			"metadata":{
				"execution_payload":{
					"user_goal":"hello",
					"request_id":"req-other",
					"conversation_id":"conv-metadata-002",
					"trace":{"trace_id":"trace-metadata-002"}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if !strings.Contains(response.Body.String(), "metadata.execution_payload.request_id must match request_id") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestDurableRunCreateRejectsExecutionPayloadTraceMismatch(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)

	request := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(`{
			"run_id":"run-metadata-trace",
			"conversation_id":"conv-metadata-trace",
			"turn_id":"turn-metadata-trace",
			"request_id":"req-metadata-trace",
			"trace_id":"trace-metadata-trace",
			"owner_user_id":"user-http-001",
			"surface":"public-chat-web",
			"lane":"rag",
			"metadata":{
				"execution_payload":{
					"user_goal":"hello",
					"request_id":"req-metadata-trace",
					"conversation_id":"conv-metadata-trace",
					"trace":{"trace_id":"trace-other"}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if !strings.Contains(response.Body.String(), "metadata.execution_payload.trace.trace_id must match trace_id") {
		t.Fatalf("body = %s", response.Body.String())
	}
}

func TestDurableRunGetAndEventsRequireAuthAndReturnRunTruth(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	create := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-query-001", "conv-query-001")),
	)
	create.Header.Set("x-worker-origin-auth", "secret")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(
		unauthorized,
		newTestRequest(http.MethodGet, "/internal/durable/runs/run-query-001", nil),
	)
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	getRequest := newTestRequest(http.MethodGet, "/internal/durable/runs/run-query-001", nil)
	getRequest.Header.Set("x-worker-origin-auth", "secret")
	getResponse := httptest.NewRecorder()
	server.ServeHTTP(getResponse, getRequest)
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d; body: %s", getResponse.Code, getResponse.Body.String())
	}
	getBody := decodeBody(t, getResponse)
	if getBody["run_id"] != "run-query-001" || getBody["status"] != "queued" {
		t.Fatalf("get body = %#v", getBody)
	}

	eventsRequest := newTestRequest(
		http.MethodGet,
		"/internal/durable/runs/run-query-001/events",
		nil,
	)
	eventsRequest.Header.Set("x-worker-origin-auth", "secret")
	eventsResponse := httptest.NewRecorder()
	server.ServeHTTP(eventsResponse, eventsRequest)
	if eventsResponse.Code != http.StatusOK {
		t.Fatalf("events status = %d; body: %s", eventsResponse.Code, eventsResponse.Body.String())
	}
	eventsBody := decodeBody(t, eventsResponse)
	events, ok := eventsBody["events"].([]any)
	if !ok || len(events) != 2 {
		t.Fatalf("events body = %#v", eventsBody)
	}
	first := expectRecord(t, events[0], "events[0]")
	if first["event_type"] != "run.created" || first["sequence"] != float64(1) {
		t.Fatalf("first event = %#v", first)
	}

	cursorRequest := newTestRequest(
		http.MethodGet,
		"/internal/durable/runs/run-query-001/events?after_sequence=1",
		nil,
	)
	cursorRequest.Header.Set("x-worker-origin-auth", "secret")
	cursorResponse := httptest.NewRecorder()
	server.ServeHTTP(cursorResponse, cursorRequest)
	if cursorResponse.Code != http.StatusOK {
		t.Fatalf("cursor events status = %d; body: %s", cursorResponse.Code, cursorResponse.Body.String())
	}
	cursorBody := decodeBody(t, cursorResponse)
	cursorEvents, ok := cursorBody["events"].([]any)
	if !ok || len(cursorEvents) != 1 {
		t.Fatalf("cursor events body = %#v", cursorBody)
	}
	cursorFirst := expectRecord(t, cursorEvents[0], "cursor events[0]")
	if cursorFirst["event_type"] != "run.queued" || cursorFirst["sequence"] != float64(2) {
		t.Fatalf("cursor first event = %#v", cursorFirst)
	}
}

func TestDurableRunCancelTransitionsRunAndAppendsEvent(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachDurableRuntimeStoreForHandlerTest(server, store)
	create := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-cancel-001", "conv-cancel-001")),
	)
	create.Header.Set("x-worker-origin-auth", "secret")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}

	cancel := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs/run-cancel-001/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	cancel.Header.Set("x-worker-origin-auth", "secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancel)

	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	body := decodeBody(t, cancelResponse)
	if body["status"] != "canceled" {
		t.Fatalf("cancel body = %#v", body)
	}
	run, err := store.GetRun(cancel.Context(), "run-cancel-001")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonUserCanceled {
		t.Fatalf("terminal reason = %q, want user_canceled", run.TerminalReason)
	}
	events, err := store.ListRunEvents(cancel.Context(), "run-cancel-001")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunCreated,
		execution.DurableRunEventTypeRunQueued,
		execution.DurableRunEventTypeRunCanceled,
	})
}

func TestDurableRunCancelPropagatesBridgeCancelAndReleasesActiveLease(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 18, 0, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(
		t,
		store,
		execution.DurableLaneRAG,
		"worker-http-cancel",
		now,
	)
	cancelCalls := []bridge.CancelRequest{}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		cancelFn: func(_ context.Context, request bridge.CancelRequest) (bridge.CancelResponse, error) {
			cancelCalls = append(cancelCalls, request)
			return bridge.CancelResponse{
				StatusCode: http.StatusAccepted,
				Body:       []byte(`{"status":"cancel_requested"}`),
			}, nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	create := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-cancel-active-http", "conv-cancel-active-http")),
	)
	create.Header.Set("x-worker-origin-auth", "secret")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}
	if _, err := server.durableLeaseCoordinator.AcquireNextLease(create.Context(), execution.NextExecutionLeaseRequest{
		LeaseID:   "lease-cancel-active-http",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  "worker-http-cancel",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(31 * time.Second),
	}); err != nil {
		t.Fatalf("acquire active lease: %v", err)
	}

	cancel := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs/run-cancel-active-http/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	cancel.Header.Set("x-worker-origin-auth", "secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancel)

	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	if len(cancelCalls) != 1 {
		t.Fatalf("bridge cancel calls = %d, want 1", len(cancelCalls))
	}
	if cancelCalls[0].RequestID != "req-run-cancel-active-http" {
		t.Fatalf("bridge cancel request_id = %q", cancelCalls[0].RequestID)
	}
	events, err := store.ListRunEvents(cancel.Context(), "run-cancel-active-http")
	if err != nil {
		t.Fatalf("list cancel events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunCreated,
		execution.DurableRunEventTypeRunQueued,
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeLeaseReleased,
		execution.DurableRunEventTypeRunCanceled,
	})
	if events[5].Payload["release_reason"] != string(execution.DurableTerminalReasonUserCanceled) {
		t.Fatalf("lease release payload = %#v", events[5].Payload)
	}
}

func TestDurableRunCancelFailsClosedWhenActiveBridgeCancelIsNotAccepted(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 18, 5, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(
		t,
		store,
		execution.DurableLaneRAG,
		"worker-http-cancel-failed",
		now,
	)
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		cancelFn: func(_ context.Context, _ bridge.CancelRequest) (bridge.CancelResponse, error) {
			return bridge.CancelResponse{
				StatusCode: http.StatusNotFound,
				Body:       []byte(`{"error":{"code":"execution_not_found"}}`),
			}, nil
		},
	})
	attachDurableRuntimeStoreForHandlerTest(server, store)
	create := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-cancel-failed-http", "conv-cancel-failed-http")),
	)
	create.Header.Set("x-worker-origin-auth", "secret")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, create)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d; body: %s", createResponse.Code, createResponse.Body.String())
	}
	if _, err := server.durableLeaseCoordinator.AcquireNextLease(create.Context(), execution.NextExecutionLeaseRequest{
		LeaseID:   "lease-cancel-failed-http",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  "worker-http-cancel-failed",
		Now:       now.Add(time.Second),
		ExpiresAt: now.Add(31 * time.Second),
	}); err != nil {
		t.Fatalf("acquire active lease: %v", err)
	}

	cancel := newTestRequest(
		http.MethodPost,
		"/internal/durable/runs/run-cancel-failed-http/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	cancel.Header.Set("x-worker-origin-auth", "secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancel)

	assertError(t, cancelResponse, http.StatusBadGateway, "durable_bridge_cancel_failed")
}

func durableRunCreateBodyForTest(runID string, conversationID string) string {
	return `{
		"run_id":"` + runID + `",
		"conversation_id":"` + conversationID + `",
		"turn_id":"turn-` + runID + `",
		"request_id":"req-` + runID + `",
		"owner_user_id":"user-http-001",
		"surface":"public-chat-web",
		"lane":"rag",
		"metadata":{
			"execution_payload":{
				"user_goal":"hello",
				"request_id":"req-` + runID + `",
				"conversation_id":"` + conversationID + `",
				"runtime_decisions":{"runtime_decision_summary":{}}
			},
			"handoff":{
				"target":"rag-agent",
				"payload_kind":"rag_request",
				"allowed_tools":["retrieval.query"],
				"payload":{"query_text":"hello"}
			}
		}
	}`
}

func attachDurableRuntimeStoreForHandlerTest(
	server *Server,
	store execution.DurableRuntimeStore,
) {
	server.durableRuntime = store
	server.durableLeaseCoordinator = execution.NewDurableLeaseCoordinator(store)
}
