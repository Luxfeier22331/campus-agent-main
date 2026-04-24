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
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
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
				"audit_runtime":{"healthy":true,"queue_depth":0},
				"transport_runtime":{"healthy":true,"active_answers":2,"max_concurrent_answers":4}
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
	workerTransport := expectRecord(t, bridgeRuntime["worker_transport_runtime"], "worker_transport_runtime")
	if workerTransport["active_answers"] != float64(2) {
		t.Fatalf("worker transport active_answers = %v, want 2", workerTransport["active_answers"])
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_full")
	if response.Header().Get("retry-after") != "3" {
		t.Fatalf("retry-after = %q, want 3", response.Header().Get("retry-after"))
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
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_timeout")
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
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusForbidden, "disallowed_knowledge_scope")
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "",
			Body:       json.RawMessage(`{}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	saturatedRequest.Header.Set("authorization", "Bearer secret-token")
	saturatedResponse := httptest.NewRecorder()
	server.ServeHTTP(saturatedResponse, saturatedRequest)
	lease.Release()
	assertError(t, saturatedResponse, http.StatusServiceUnavailable, "transport_queue_full")

	timeoutRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
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
		`campus_go_shell_requests_total{route="/api/v1/answer",outcome="supervisor_response",status_class="2xx"} 1`,
		`campus_go_shell_requests_total{route="/api/v1/answer",outcome="transport_queue_full",status_class="5xx"} 1`,
		`campus_go_shell_requests_total{route="/api/v1/answer",outcome="supervisor_bridge_timeout",status_class="5xx"} 1`,
		`campus_go_shell_admission_decisions_total{decision="queue_full"} 1`,
		`campus_go_shell_admission_queue_depth 0`,
		`campus_go_shell_admission_active 0`,
		`campus_go_shell_bridge_failures_total{kind="timeout"} 1`,
		`campus_go_shell_inflight_requests{route="/api/v1/answer"} 0`,
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
					"status":"ready",
					"transport_runtime":{"healthy":true}
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
		strings.NewReader(`{"user_goal":"hello"}`),
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
	if !strings.Contains(authorized.Body.String(), "campus_go_shell_requests_total") {
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
					"audit_runtime":{"healthy":true,"queue_depth":0},
					"transport_runtime":{"healthy":true,"active_answers":0,"max_concurrent_answers":8}
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
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	timeoutRequest.Header.Set("authorization", "Bearer secret-token")
	timeoutResponse := httptest.NewRecorder()
	server.ServeHTTP(timeoutResponse, timeoutRequest)
	assertError(t, timeoutResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	successRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
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
		strings.NewReader(`{"user_goal":"secret-question"}`),
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

type fakeBridge struct {
	configured bool
	response   bridge.ExecuteResponse
	readyz     bridge.ReadyzResponse
	executeErr error
	readyzErr  error
	seen       bridge.Request
	executeFn  func(context.Context, bridge.Request) (bridge.ExecuteResponse, error)
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
