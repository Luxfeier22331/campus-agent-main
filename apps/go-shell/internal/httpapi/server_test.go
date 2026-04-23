package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
)

func TestHealthzReturnsOk(t *testing.T) {
	server := NewServer(config.Config{AppName: "campus-agent"}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

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

	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))

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

	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))

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
		httptest.NewRequest(http.MethodPost, "/api/v1/answer", strings.NewReader("{")),
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
		httptest.NewRequest(http.MethodPost, "/api/v1/answer", strings.NewReader(`{"user_goal":"hello"}`)),
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
		httptest.NewRequest(http.MethodPost, "/api/v1/answer", bytes.NewBufferString(`{"x":"too-large"}`)),
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
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "bridge_not_configured")
}

func TestAnswerReturnsTransportSaturated(t *testing.T) {
	limiter := admission.NewLimiter(1)
	release, ok := limiter.TryAcquire()
	if !ok {
		t.Fatal("expected setup acquire to succeed")
	}
	defer release()

	server := NewServerWithLimiter(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
		},
		&fakeBridge{configured: true},
		limiter,
	)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_saturated")
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
	request := httptest.NewRequest(
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
	request := httptest.NewRequest(
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
	request := httptest.NewRequest(
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
	request := httptest.NewRequest(
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
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"hello"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusGatewayTimeout, "supervisor_bridge_timeout")
}

type fakeBridge struct {
	configured bool
	response   bridge.ExecuteResponse
	readyz     bridge.ReadyzResponse
	executeErr error
	readyzErr  error
	seen       bridge.Request
}

func (f *fakeBridge) Configured() bool {
	return f.configured
}

func (f *fakeBridge) Execute(_ context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
	f.seen = request
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

func TestFakeBridgeImplementsClient(t *testing.T) {
	var client bridge.Client = &fakeBridge{}
	if client == nil {
		t.Fatal("bridge client should not be nil")
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
