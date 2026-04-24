package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func newTestRequest(method string, target string, body io.Reader) *http.Request {
	return httptest.NewRequestWithContext(context.Background(), method, target, body)
}

func TestHealthzReturnsOk(t *testing.T) {
	server := NewServer(config.Config{AppName: "campus-agent"}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}

	body := decodeBody(t, response)
	if body["status"] != "ok" {
		t.Fatalf("status body = %v, want ok", body["status"])
	}
	if body["app_name"] != "campus-agent" {
		t.Fatalf("app_name = %v, want campus-agent", body["app_name"])
	}
}

func TestReadyzReportsBridgeNotConfigured(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 8,
	}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}

	body := decodeBody(t, response)
	if body["status"] != "degraded" {
		t.Fatalf("status body = %v, want degraded", body["status"])
	}
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["configured"] != false {
		t.Fatalf("bridge configured = %v, want false", bridgeRuntime["configured"])
	}
}

func TestAnswerRequestLogUsesSupervisorAPIEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))
	server := NewServerWithDependencies(config.Config{}, nil, nil, logger, nil)

	server.logAnswerRequest(
		context.Background(),
		"trace-001",
		http.StatusOK,
		"supervisor_response",
		12*time.Millisecond,
	)

	logged := logBuffer.String()
	if !strings.Contains(logged, "supervisor_api.answer_request") {
		t.Fatalf("log output = %q, want supervisor_api.answer_request", logged)
	}
	staleNamespace := "go_" + "shell."
	if strings.Contains(logged, staleNamespace) {
		t.Fatalf("log output = %q, must not contain stale namespace", logged)
	}
}

func TestReadyzMergesWorkerReadinessAndGoTransportStatus(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 8,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"runtime_provider":"mock-runtime",
				"prompt_runtime":{"provider":"mock-runtime","admitted":true},
				"prompt_http_pool":{"healthy":true,"max_connections":32},
				"audit_runtime":{"healthy":true,"queue_depth":0}
			}`),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}

	body := decodeBody(t, response)
	if body["status"] != "ready" {
		t.Fatalf("status body = %v, want ready", body["status"])
	}
	if body["runtime_provider"] != "mock-runtime" {
		t.Fatalf("runtime_provider = %v, want mock-runtime", body["runtime_provider"])
	}
	transportRuntime := expectRecord(t, body["transport_runtime"], "transport_runtime")
	if transportRuntime["max_concurrent_answers"] != float64(8) {
		t.Fatalf(
			"transport_runtime.max_concurrent_answers = %v, want 8",
			transportRuntime["max_concurrent_answers"],
		)
	}
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["healthy"] != true {
		t.Fatalf("bridge_runtime.healthy = %v, want true", bridgeRuntime["healthy"])
	}
	workerTransportKey := "worker_" + "transport_runtime"
	if _, ok := bridgeRuntime[workerTransportKey]; ok {
		t.Fatalf("bridge_runtime.%s must not be published", workerTransportKey)
	}
}

func TestAnswerRejectsInvalidJSON(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/api/v1/answer", strings.NewReader("{")),
	)

	assertError(t, response, http.StatusBadRequest, "invalid_json")
}

func TestAnswerRejectsMissingBearerToken(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/api/v1/answer", strings.NewReader(`{"user_goal":"hello"}`)),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestAnswerRejectsBodyTooLarge(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes: 8,
		MaxConcurrentAnswers:  8,
	}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodPost, "/api/v1/answer", bytes.NewBufferString(`{"x":"too-large"}`)),
	)

	assertError(t, response, http.StatusRequestEntityTooLarge, "request_body_too_large")
}

func TestAnswerFailsClosedWhenBridgeIsMissing(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-bridge-missing"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "bridge_not_configured")
}

func TestAnswerReturnsQueueFullWhenAdmissionQueueIsFull(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         0,
			QueueTimeoutMS:        3_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-queue-full"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_full")
	if response.Header().Get("retry-after") != "3" {
		t.Fatalf("retry-after = %q, want 3", response.Header().Get("retry-after"))
	}
}

func TestAnswerQueueFullEmitsExecutionAuditEvent(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/internal/execution/audit-events" {
			t.Fatalf("audit path = %q, want /api/internal/execution/audit-events", request.URL.Path)
		}
		if request.Header.Get("x-app-internal-auth") != "audit-secret" {
			t.Fatalf("x-app-internal-auth = %q, want audit-secret", request.Header.Get("x-app-internal-auth"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:                    "bearer",
			BearerToken:                 "secret-token",
			DefaultActorID:              "runtime-bearer-user",
			ExecutionAuditBatchSize:     1,
			ExecutionAuditEnabled:       true,
			ExecutionAuditQueueCapacity: 4,
			ExecutionAuditSharedSecret:  "audit-secret",
			ExecutionAuditTimeoutMS:     500,
			ExecutionAuditURL:           auditServer.URL + "/api/internal/execution/audit-events",
			RequestBodyLimitBytes:       1_048_576,
			MaxConcurrentAnswers:        1,
			QueueCapacity:               0,
			QueueTimeoutMS:              3_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-audit-queue-full"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_full")
	select {
	case body := <-received:
		events, ok := body["events"].([]any)
		if !ok || len(events) != 1 {
			t.Fatalf("events = %#v, want one event", body["events"])
		}
		event, ok := events[0].(map[string]any)
		if !ok {
			t.Fatalf("event = %#v, want object", events[0])
		}
		if event["event_type"] != "execution.admission_rejected" {
			t.Fatalf("event_type = %v, want execution.admission_rejected", event["event_type"])
		}
		if event["request_id"] != "req-audit-queue-full" {
			t.Fatalf("request_id = %v", event["request_id"])
		}
		if _, ok := event["user_goal"]; ok {
			t.Fatal("audit event must not include raw user_goal")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerReturnsQueueTimeoutWhenAdmissionWaitExpires(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  5 * time.Millisecond,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         1,
			QueueTimeoutMS:        5,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-queue-timeout"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_lane_queue_timeout")
}

func TestAnswerDelegatesProjectedPayloadAndInjectsTraceID(t *testing.T) {
	bridgeClient := &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "supervisor_response",
			Body: json.RawMessage(`{
				"selected_target":"rag-agent",
				"status":"completed",
				"answer_text":"ok"
			}`),
		},
	}
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "api-bearer-user",
		DefaultActorRoles:     []string{"student"},
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, bridgeClient)
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{
			"user_goal":"hello",
			"request_id":"req-001",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"}
		}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-1")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}

	payload := decodeBody(t, response)
	if payload["trace_id"] != "trace-1" {
		t.Fatalf("trace_id = %v, want trace-1", payload["trace_id"])
	}

	projected := decodeJSONRecord(t, bridgeClient.seen.Payload)
	trace := expectRecord(t, projected["trace"], "trace")
	if trace["trace_id"] != "trace-1" {
		t.Fatalf("bridge trace_id = %v, want trace-1", trace["trace_id"])
	}
	contextRecord := expectRecord(t, projected["context"], "context")
	actorRecord := expectRecord(t, contextRecord["actor"], "context.actor")
	if actorRecord["user_id"] != "api-bearer-user" {
		t.Fatalf("context.actor.user_id = %v, want api-bearer-user", actorRecord["user_id"])
	}
	versionQuery := expectRecord(t, projected["version_query"], "version_query")
	if versionQuery["mode"] != "current" {
		t.Fatalf("version_query.mode = %v, want current", versionQuery["mode"])
	}
}

func TestAnswerPassesSupervisorErrorsThrough(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusForbidden,
			Kind:       "supervisor_error",
			Body: json.RawMessage(`{
				"error":{"code":"disallowed_knowledge_scope","message":"scope disabled","retryable":false}
			}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-supervisor-error"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusForbidden, "disallowed_knowledge_scope")
}

func TestAnswerMapsSupervisorBridgeCancellationToCanceledLifecycle(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: statusClientClosedRequest,
			Kind:       "supervisor_error",
			Body: json.RawMessage(`{
				"error":{"code":"execution_cancelled","message":"Supervisor execution was cancelled.","retryable":false}
			}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-bridge-cancelled"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, statusClientClosedRequest, "execution_cancelled")
	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_supervisor_api_lifecycle_completed_total{state="canceled"} 1`,
	) {
		t.Fatalf("metrics missing canceled lifecycle final state:\n%s", metricsResponse.Body.String())
	}
}

func TestAnswerMapsBridgeInvalidRequestToBadGateway(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusBadRequest,
			Kind:       "bridge_invalid_request",
			Body:       json.RawMessage(`{"error":{"code":"invalid_request","message":"bad"}}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-bridge-invalid-request"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_request")
}

func TestAnswerRejectsMissingBridgeEnvelope(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			time.Sleep(2 * time.Millisecond)
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "",
				Body:       json.RawMessage(`{}`),
			}, nil
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-missing-bridge-envelope"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_supervisor_api_lifecycle_completed_total{state="failed"} 1`,
	) {
		t.Fatalf("metrics missing failed lifecycle final state:\n%s", metricsResponse.Body.String())
	}
}

func TestAnswerShortCircuitsWhenBridgeCircuitIsOpen(t *testing.T) {
	calls := 0
	server := NewServer(config.Config{
		AuthMode:                      "bearer",
		BearerToken:                   "secret-token",
		DefaultActorID:                "runtime-bearer-user",
		RequestBodyLimitBytes:         1_048_576,
		MaxConcurrentAnswers:          8,
		BridgeBreakerFailureThreshold: 1,
		BridgeBreakerOpenMS:           60_000,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			calls++
			return bridge.ExecuteResponse{}, context.DeadlineExceeded
		},
	})

	firstRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-breaker-first"}`),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	server.ServeHTTP(firstResponse, firstRequest)
	assertError(t, firstResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	secondRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-breaker-open"}`),
	)
	secondRequest.Header.Set("authorization", "Bearer secret-token")
	secondResponse := httptest.NewRecorder()
	server.ServeHTTP(secondResponse, secondRequest)

	assertError(t, secondResponse, http.StatusServiceUnavailable, "supervisor_bridge_circuit_open")
	if calls != 1 {
		t.Fatalf("bridge calls = %d, want 1", calls)
	}
	readyResponse := httptest.NewRecorder()
	server.ServeHTTP(readyResponse, newTestRequest(http.MethodGet, "/readyz", nil))
	if readyResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz status = %d, want 503", readyResponse.Code)
	}
	readyBody := decodeBody(t, readyResponse)
	bridgeRuntime := expectRecord(t, readyBody["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["circuit_state"] != "open" {
		t.Fatalf("circuit_state = %v, want open", bridgeRuntime["circuit_state"])
	}
}

func TestAnswerBridgeProtocolFailureAuditIncludesBridgeDuration(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	server := NewServer(config.Config{
		AuthMode:                    "bearer",
		BearerToken:                 "secret-token",
		DefaultActorID:              "runtime-bearer-user",
		ExecutionAuditBatchSize:     1,
		ExecutionAuditEnabled:       true,
		ExecutionAuditQueueCapacity: 4,
		ExecutionAuditSharedSecret:  "audit-secret",
		ExecutionAuditTimeoutMS:     500,
		ExecutionAuditURL:           auditServer.URL + "/api/internal/execution/audit-events",
		RequestBodyLimitBytes:       1_048_576,
		MaxConcurrentAnswers:        8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			time.Sleep(2 * time.Millisecond)
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "",
				Body:       json.RawMessage(`{}`),
			}, nil
		},
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-audit-bridge-protocol"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
	select {
	case body := <-received:
		events, ok := body["events"].([]any)
		if !ok || len(events) != 1 {
			t.Fatalf("events = %#v, want one event", body["events"])
		}
		event, ok := events[0].(map[string]any)
		if !ok {
			t.Fatalf("event = %#v, want object", events[0])
		}
		if event["bridge_duration_ms"] == nil {
			t.Fatalf("bridge_duration_ms = nil, want measured duration: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerMapsBridgeTimeout(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		BridgeTimeoutMS:       1,
	}, &fakeBridge{
		configured: true,
		executeErr: context.DeadlineExceeded,
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-bridge-timeout"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusGatewayTimeout, "supervisor_bridge_timeout")
}

func TestAnswerReturnsWithoutWritingWhenClientContextIsCanceled(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-client-cancelled"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	canceledContext, cancel := context.WithCancel(request.Context())
	cancel()
	request = request.WithContext(canceledContext)

	response := newTrackingResponseWriter()
	server.ServeHTTP(response, request)

	if response.wrote {
		t.Fatalf("expected canceled request to stop without writing response, wrote status %d", response.status)
	}
}

func TestAnswerRejectsDuplicateInFlightRequestID(t *testing.T) {
	bridgeStarted := make(chan struct{})
	releaseBridge := make(chan struct{})
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		WorkerSharedSecret:    "worker-secret",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  2,
		QueueCapacity:         2,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			select {
			case <-ctx.Done():
				return bridge.ExecuteResponse{}, ctx.Err()
			case <-releaseBridge:
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "supervisor_response",
					Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
				}, nil
			}
		},
	})

	firstRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-duplicate"}`),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(firstResponse, firstRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	secondRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello again","request_id":"req-duplicate"}`),
	)
	secondRequest.Header.Set("authorization", "Bearer secret-token")
	secondResponse := httptest.NewRecorder()
	server.ServeHTTP(secondResponse, secondRequest)
	assertError(t, secondResponse, http.StatusConflict, "execution_already_in_flight")

	close(releaseBridge)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("first request did not complete")
	}
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("first response status = %d, want 200; body: %s", firstResponse.Code, firstResponse.Body.String())
	}
}

func TestCancelEndpointCancelsActiveExecution(t *testing.T) {
	bridgeStarted := make(chan struct{})
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		WorkerSharedSecret:    "worker-secret",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  1,
		QueueCapacity:         1,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})

	answerRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-cancel-active"}`),
	)
	answerRequest.Header.Set("authorization", "Bearer secret-token")
	answerResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(answerResponse, answerRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	cancelRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-cancel-active","reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	cancelBody := decodeBody(t, cancelResponse)
	if cancelBody["status"] != "cancel_requested" {
		t.Fatalf("cancel status body = %v, want cancel_requested", cancelBody["status"])
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("answer request did not finish after cancel")
	}
	assertError(t, answerResponse, statusClientClosedRequest, "execution_cancelled")

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		"campus_supervisor_api_lifecycle_cancel_requested_total 1",
	) {
		t.Fatalf("metrics missing cancel count:\n%s", metricsResponse.Body.String())
	}
}

func TestCancelEndpointPropagatesCooperativeCancelToPythonBridge(t *testing.T) {
	bridgeStarted := make(chan struct{})
	cancelSeen := make(chan bridge.CancelRequest, 1)
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		WorkerSharedSecret:    "worker-secret",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  1,
		QueueCapacity:         1,
		BridgeCancelTimeoutMS: 500,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
		cancelFn: func(ctx context.Context, request bridge.CancelRequest) (bridge.CancelResponse, error) {
			cancelSeen <- request
			return bridge.CancelResponse{
				StatusCode: http.StatusAccepted,
				Body:       json.RawMessage(`{"request_id":"req-cooperative-cancel","status":"cancel_requested"}`),
			}, nil
		},
	})

	answerRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-cooperative-cancel"}`),
	)
	answerRequest.Header.Set("authorization", "Bearer secret-token")
	answerResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(answerResponse, answerRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	cancelRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-cooperative-cancel","reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	cancelBody := decodeBody(t, cancelResponse)
	if cancelBody["bridge_cancel_status"] != "accepted" {
		t.Fatalf("bridge_cancel_status = %v, want accepted", cancelBody["bridge_cancel_status"])
	}

	select {
	case request := <-cancelSeen:
		if request.RequestID != "req-cooperative-cancel" {
			t.Fatalf("bridge cancel request_id = %q", request.RequestID)
		}
		if request.Reason != "user_requested" {
			t.Fatalf("bridge cancel reason = %q", request.Reason)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cooperative bridge cancel")
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("answer request did not finish after cancel")
	}
}

func TestCancelEndpointRequiresWorkerAuthAndActiveExecution(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes: 1_048_576,
		WorkerSharedSecret:    "worker-secret",
		MaxConcurrentAnswers:  1,
	}, nil)

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(
		unauthorized,
		newTestRequest(http.MethodPost, "/internal/execution/cancel", strings.NewReader(`{"request_id":"req-1"}`)),
	)
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	notFoundRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-missing"}`),
	)
	notFoundRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	notFound := httptest.NewRecorder()
	server.ServeHTTP(notFound, notFoundRequest)
	assertError(t, notFound, http.StatusNotFound, "execution_not_found")
}

func TestStructuredQueryServiceStatusUsesConfiguredProjectionBundle(t *testing.T) {
	projectionPath := writeStructuredQueryProjectionFixture(t, `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"override_source_refs":["notice:library-hours"],
				"related_notice_refs":["notice:library-hours"]
			}
		]
	}`)
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		StructuredQuerySharedSecret:       "query-secret",
		StructuredQueryProjectionPath:     projectionPath,
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/service-status",
		strings.NewReader(`{
			"subject_query":"图书馆今天开门吗",
			"temporal_query":{"mode":"current"},
			"campus_scope":"haidian"
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	if body["resolved_subject"] != "海淀校区图书馆" {
		t.Fatalf("resolved_subject = %v", body["resolved_subject"])
	}
	if body["observed_status"] != "open" {
		t.Fatalf("observed_status = %v", body["observed_status"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_supervisor_api_structured_query_requests_total{tool="service_status_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryTransportScheduleUsesConfiguredProjectionBundle(t *testing.T) {
	projectionPath := writeStructuredQueryProjectionFixture(t, `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"transport_routes":[
			{
				"route_id":"route:haidian-to-fengtai",
				"display_name":"海淀到丰台通勤车",
				"service_family":"intercampus_commute",
				"origin_campus":"haidian",
				"destination_campus":"fengtai",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门"},
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门"}
				]
			}
		],
		"scheduled_departures":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"route_id":"route:haidian-to-fengtai",
				"service_dates":["2026-04-25"],
				"departure_time":"06:50",
				"arrival_time":"08:05",
				"origin_stop_id":"stop:haidian-east-gate",
				"destination_stop_id":"stop:fengtai-main-gate"
			}
		]
	}`)
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		StructuredQuerySharedSecret:       "query-secret",
		StructuredQueryProjectionPath:     projectionPath,
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T20:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/transport-schedule",
		strings.NewReader(`{
			"query_text":"我明天早上要去丰台上课，最早的班车是几点",
			"intent":"first_departure",
			"route_selector":{"destination_campus":"fengtai"},
			"snapshot_query":{"mode":"current"},
			"service_time_query":{"date_mode":"tomorrow","daypart":"morning"}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	selectedDeparture := expectRecord(t, body["selected_departure"], "selected_departure")
	if selectedDeparture["departure_at"] != "2026-04-25T06:50:00+08:00" {
		t.Fatalf("departure_at = %v", selectedDeparture["departure_at"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_supervisor_api_structured_query_requests_total{tool="transport_schedule_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryTransportScheduleFailsClosedWhenProjectionUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		StructuredQuerySharedSecret:       "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/transport-schedule",
		strings.NewReader(`{
			"query_text":"最近的校车时刻表是什么",
			"intent":"schedule_snapshot_metadata",
			"snapshot_query":{"mode":"current"}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "temporarily_unverifiable" {
		t.Fatalf("outcome = %v, want temporarily_unverifiable", body["outcome"])
	}
	if body["fail_close_reason"] != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %v, want source_truth_unavailable", body["fail_close_reason"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}
}

func TestStructuredQueryNoticeDiscoverRequiresQueryAuth(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:        8,
		RequestBodyLimitBytes:       1_048_576,
		StructuredQuerySharedSecret: "query-secret",
	}, nil)

	response := httptest.NewRecorder()
	server.ServeHTTP(
		response,
		newTestRequest(
			http.MethodPost,
			"/internal/query/notices/discover",
			strings.NewReader(`{"payload":{"query_text":"家具采购"}}`),
		),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestStructuredQueryNoticeDiscoverFailsClosedWhenReadModelUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		StructuredQuerySharedSecret:       "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/notices/discover",
		strings.NewReader(`{
			"payload":{
				"query_text":"家具采购",
				"source_families":["internal_notice_restricted"]
			},
			"access_context":{
				"authorization":{
					"principal_id":"principal-001",
					"entitlement_groups":["students"],
					"retrieval_filter":{
						"entitlement_groups":["students"],
						"visibility_level":"restricted"
					}
				}
			}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "temporarily_unverifiable" {
		t.Fatalf("outcome = %v, want temporarily_unverifiable", body["outcome"])
	}
	if body["fail_close_reason"] != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %v, want source_truth_unavailable", body["fail_close_reason"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}
}

func TestMetricsEndpointReportsCountersForSuccessSaturationAndTimeout(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	callCount := 0
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         0,
			QueueTimeoutMS:        3_000,
		},
		&fakeBridge{
			configured: true,
			executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
				callCount++
				if callCount == 1 {
					return bridge.ExecuteResponse{
						StatusCode: http.StatusOK,
						Kind:       "supervisor_response",
						Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
					}, nil
				}
				return bridge.ExecuteResponse{}, context.DeadlineExceeded
			},
		},
		controller,
		nil,
		nil,
	)

	successRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-metrics-success"}`),
	)
	successRequest.Header.Set("authorization", "Bearer secret-token")
	successResponse := httptest.NewRecorder()
	server.ServeHTTP(successResponse, successRequest)
	if successResponse.Code != http.StatusOK {
		t.Fatalf("success status = %d, want 200", successResponse.Code)
	}

	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected limiter acquire to succeed for saturation setup")
	}
	saturatedRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-metrics-saturated"}`),
	)
	saturatedRequest.Header.Set("authorization", "Bearer secret-token")
	saturatedResponse := httptest.NewRecorder()
	server.ServeHTTP(saturatedResponse, saturatedRequest)
	lease.Release()
	assertError(t, saturatedResponse, http.StatusServiceUnavailable, "transport_queue_full")

	timeoutRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-metrics-timeout"}`),
	)
	timeoutRequest.Header.Set("authorization", "Bearer secret-token")
	timeoutResponse := httptest.NewRecorder()
	server.ServeHTTP(timeoutResponse, timeoutRequest)
	assertError(t, timeoutResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if metricsResponse.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want 200", metricsResponse.Code)
	}
	metricsBody := metricsResponse.Body.String()
	expectedSnippets := []string{
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="supervisor_response",status_class="2xx"} 1`,
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="transport_queue_full",status_class="5xx"} 1`,
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="supervisor_bridge_timeout",status_class="5xx"} 1`,
		`campus_supervisor_api_admission_decisions_total{decision="queue_full"} 1`,
		`campus_supervisor_api_admission_queue_depth 0`,
		`campus_supervisor_api_admission_active 0`,
		`campus_supervisor_api_bridge_failures_total{kind="timeout"} 1`,
		`campus_supervisor_api_inflight_requests{route="/api/v1/answer"} 0`,
	}
	for _, snippet := range expectedSnippets {
		if !strings.Contains(metricsBody, snippet) {
			t.Fatalf("expected metrics body to contain %q, got:\n%s", snippet, metricsBody)
		}
	}
}

func TestReadyzKeepsTransportReadyWhenAllSlotsAreBusyButQueueCanAccept(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithDependencies(
		config.Config{
			AppName:              "campus-agent",
			MaxConcurrentAnswers: 1,
			QueueCapacity:        1,
			QueueTimeoutMS:       1_000,
		},
		&fakeBridge{
			configured: true,
			readyz: bridge.ReadyzResponse{
				StatusCode: http.StatusOK,
				Body: json.RawMessage(`{
					"status":"ready"
				}`),
			},
		},
		controller,
		nil,
		nil,
	)

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	transportRuntime := expectRecord(t, body["transport_runtime"], "transport_runtime")
	if transportRuntime["active_answers"] != float64(1) {
		t.Fatalf("active_answers = %v, want 1", transportRuntime["active_answers"])
	}
	if transportRuntime["queue_capacity"] != float64(1) {
		t.Fatalf("queue_capacity = %v, want 1", transportRuntime["queue_capacity"])
	}
	if transportRuntime["accepting"] != true {
		t.Fatalf("accepting = %v, want true", transportRuntime["accepting"])
	}
	lanes := expectRecord(t, transportRuntime["lanes"], "transport_runtime.lanes")
	if _, ok := lanes["default"]; !ok {
		t.Fatalf("transport_runtime.lanes missing default: %#v", lanes)
	}
	lifecycleRuntime := expectRecord(t, body["lifecycle_runtime"], "lifecycle_runtime")
	if lifecycleRuntime["active_executions"] != float64(0) {
		t.Fatalf("active executions = %v, want 0", lifecycleRuntime["active_executions"])
	}
}

func TestReadyzDegradesWhenOTelEnabledWithoutExporter(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 1,
		QueueCapacity:        1,
		QueueTimeoutMS:       1_000,
		OTelEnabled:          true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	telemetryRuntime := expectRecord(t, body["telemetry_runtime"], "telemetry_runtime")
	if telemetryRuntime["enabled"] != true || telemetryRuntime["exporter_configured"] != false {
		t.Fatalf("unexpected telemetry runtime: %#v", telemetryRuntime)
	}
	if telemetryRuntime["last_error"] == "" {
		t.Fatal("expected telemetry last_error to be populated")
	}
}

func TestAnswerRejectsWhileAdmissionIsDraining(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})
	controller.StartDraining()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         1,
			QueueTimeoutMS:        1_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-draining"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_draining")
}

func TestMetricsEndpointRequiresBearerTokenWhenConfigured(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers: 8,
		MetricsBearerToken:   "metrics-token",
	}, nil)

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(unauthorized, newTestRequest(http.MethodGet, "/metrics", nil))
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	authorized := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("authorization", "Bearer metrics-token")
	server.ServeHTTP(authorized, request)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized metrics status = %d, want 200", authorized.Code)
	}
	if !strings.Contains(authorized.Body.String(), "campus_supervisor_api_requests_total") {
		t.Fatalf("metrics body missing request total: %s", authorized.Body.String())
	}
}

func TestReadyzIncludesBridgeAnswerHistoryFingerprint(t *testing.T) {
	callCount := 0
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  8,
		},
		&fakeBridge{
			configured: true,
			executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
				callCount++
				if callCount == 1 {
					return bridge.ExecuteResponse{}, context.DeadlineExceeded
				}
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "supervisor_response",
					Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
				}, nil
			},
			readyz: bridge.ReadyzResponse{
				StatusCode: http.StatusOK,
				Body: json.RawMessage(`{
					"status":"ready",
					"runtime_provider":"mock-runtime",
					"prompt_runtime":{"provider":"mock-runtime","admitted":true},
					"prompt_http_pool":{"healthy":true,"max_connections":32},
					"audit_runtime":{"healthy":true,"queue_depth":0}
				}`),
			},
		},
		nil,
		nil,
		nil,
	)

	timeoutRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-readyz-timeout"}`),
	)
	timeoutRequest.Header.Set("authorization", "Bearer secret-token")
	timeoutResponse := httptest.NewRecorder()
	server.ServeHTTP(timeoutResponse, timeoutRequest)
	assertError(t, timeoutResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	successRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-readyz-success"}`),
	)
	successRequest.Header.Set("authorization", "Bearer secret-token")
	successResponse := httptest.NewRecorder()
	server.ServeHTTP(successResponse, successRequest)
	if successResponse.Code != http.StatusOK {
		t.Fatalf("success status = %d, want 200", successResponse.Code)
	}

	readyzResponse := httptest.NewRecorder()
	server.ServeHTTP(readyzResponse, newTestRequest(http.MethodGet, "/readyz", nil))
	if readyzResponse.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200", readyzResponse.Code)
	}
	body := decodeBody(t, readyzResponse)
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["last_answer_failure_code"] != "timeout" {
		t.Fatalf(
			"bridge_runtime.last_answer_failure_code = %v, want timeout",
			bridgeRuntime["last_answer_failure_code"],
		)
	}
	if bridgeRuntime["last_answer_failure_at"] == "" {
		t.Fatal("expected bridge_runtime.last_answer_failure_at to be populated")
	}
	if bridgeRuntime["last_answer_success_at"] == "" {
		t.Fatal("expected bridge_runtime.last_answer_success_at to be populated")
	}
}

func TestAnswerLogsTraceAndOutcomeWithoutUserGoal(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuffer, nil))
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  8,
		},
		&fakeBridge{
			configured: true,
			response: bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "supervisor_response",
				Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
			},
		},
		nil,
		logger,
		nil,
	)

	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"secret-question","request_id":"req-log-redaction"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-log-1")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}

	logOutput := logBuffer.String()
	if !strings.Contains(logOutput, `"trace_id":"trace-log-1"`) {
		t.Fatalf("expected log output to contain trace id, got: %s", logOutput)
	}
	if !strings.Contains(logOutput, `"outcome":"supervisor_response"`) {
		t.Fatalf("expected log output to contain outcome, got: %s", logOutput)
	}
	if strings.Contains(logOutput, "secret-question") {
		t.Fatalf("log output should not contain raw user_goal, got: %s", logOutput)
	}
}

func TestAnswerStreamEmitsLifecycleEvents(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "supervisor_response",
			Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-stream-success"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-stream-1")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Header().Get("content-type"), "text/event-stream") {
		t.Fatalf("content-type = %q", response.Header().Get("content-type"))
	}
	body := response.Body.String()
	for _, snippet := range []string{
		"event: execution.started",
		"event: execution.running",
		"event: execution.completed",
		`"request_id":"req-stream-success"`,
		`"trace_id":"trace-stream-1"`,
		`"response":{"answer_text":"ok"`,
	} {
		if !strings.Contains(body, snippet) {
			t.Fatalf("stream body missing %q:\n%s", snippet, body)
		}
	}
}

func TestAnswerStreamEmitsFailureWhenBridgeCircuitIsOpen(t *testing.T) {
	calls := 0
	server := NewServer(config.Config{
		AuthMode:                      "bearer",
		BearerToken:                   "secret-token",
		DefaultActorID:                "runtime-bearer-user",
		RequestBodyLimitBytes:         1_048_576,
		MaxConcurrentAnswers:          8,
		BridgeBreakerFailureThreshold: 1,
		BridgeBreakerOpenMS:           60_000,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			calls++
			return bridge.ExecuteResponse{}, context.DeadlineExceeded
		},
	})

	firstRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-stream-breaker-first"}`),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	server.ServeHTTP(firstResponse, firstRequest)
	assertError(t, firstResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	streamRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"hello","request_id":"req-stream-breaker-open"}`),
	)
	streamRequest.Header.Set("authorization", "Bearer secret-token")
	streamResponse := httptest.NewRecorder()
	server.ServeHTTP(streamResponse, streamRequest)

	if streamResponse.Code != http.StatusOK {
		t.Fatalf("stream status = %d, want 200; body: %s", streamResponse.Code, streamResponse.Body.String())
	}
	if calls != 1 {
		t.Fatalf("bridge calls = %d, want 1", calls)
	}
	body := streamResponse.Body.String()
	if !strings.Contains(body, "event: execution.failed") ||
		!strings.Contains(body, `"code":"supervisor_bridge_circuit_open"`) {
		t.Fatalf("stream body missing circuit-open failure:\n%s", body)
	}
}

type fakeBridge struct {
	configured bool
	response   bridge.ExecuteResponse
	readyz     bridge.ReadyzResponse
	executeErr error
	readyzErr  error
	seen       bridge.Request
	executeFn  func(context.Context, bridge.Request) (bridge.ExecuteResponse, error)
	cancelFn   func(context.Context, bridge.CancelRequest) (bridge.CancelResponse, error)
}

var _ bridge.Client = (*fakeBridge)(nil)

func (f *fakeBridge) Configured() bool {
	return f.configured
}

func (f *fakeBridge) Execute(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
	f.seen = request
	if f.executeFn != nil {
		return f.executeFn(ctx, request)
	}
	if f.executeErr != nil {
		return bridge.ExecuteResponse{}, f.executeErr
	}
	return f.response, nil
}

func (f *fakeBridge) Readyz(_ context.Context) (bridge.ReadyzResponse, error) {
	if f.readyzErr != nil {
		return bridge.ReadyzResponse{}, f.readyzErr
	}
	return f.readyz, nil
}

func (f *fakeBridge) Cancel(ctx context.Context, request bridge.CancelRequest) (bridge.CancelResponse, error) {
	if f.cancelFn != nil {
		return f.cancelFn(ctx, request)
	}
	return bridge.CancelResponse{
		StatusCode: http.StatusNotFound,
		Body:       json.RawMessage(`{"error":{"code":"execution_not_found"}}`),
	}, nil
}

func writeStructuredQueryProjectionFixture(t *testing.T, body string) string {
	t.Helper()
	path := t.TempDir() + "/campus-services-projection.json"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write projection fixture: %v", err)
	}
	return path
}

func decodeBody(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	return decodeJSONRecord(t, response.Body.Bytes())
}

func decodeJSONRecord(t *testing.T, rawBody []byte) map[string]any {
	t.Helper()

	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil {
		t.Fatalf("response body is not JSON: %v", err)
	}
	return body
}

func expectRecord(t *testing.T, value any, name string) map[string]any {
	t.Helper()
	record, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("%s missing or wrong type: %#v", name, value)
	}
	return record
}

func assertError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()

	if response.Code != status {
		t.Fatalf("status = %d, want %d; body: %s", response.Code, status, response.Body.String())
	}
	body := decodeBody(t, response)
	errorBody := expectRecord(t, body["error"], "error")
	if errorBody["code"] != code {
		t.Fatalf("error code = %v, want %s", errorBody["code"], code)
	}
}

func TestDecodeJSONObjectRejectsNonObjects(t *testing.T) {
	_, err := decodeJSONObject([]byte(`[]`))
	if err == nil {
		t.Fatal("expected decodeJSONObject to reject non-object JSON")
	}
	if !errors.Is(err, err) {
		t.Fatal("unexpected error shape")
	}
}

type trackingResponseWriter struct {
	header http.Header
	status int
	wrote  bool
}

func newTrackingResponseWriter() *trackingResponseWriter {
	return &trackingResponseWriter{
		header: make(http.Header),
	}
}

func (w *trackingResponseWriter) Header() http.Header {
	return w.header
}

func (w *trackingResponseWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return len(body), nil
}

func (w *trackingResponseWriter) WriteHeader(status int) {
	w.status = status
	w.wrote = true
}
