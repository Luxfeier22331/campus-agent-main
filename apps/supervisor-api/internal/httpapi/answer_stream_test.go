package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestAnswerStreamExecutesTerminalEnvelopeDirectlyInGo(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			t.Fatal("terminal runtime policy stream response must not call Python bridge")
			return bridge.ExecuteResponse{}, nil
		},
	})
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"MIT的校长是谁","request_id":"req-terminal-stream-direct"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-terminal-stream-direct")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	for _, snippet := range []string{
		"event: execution.started",
		"event: execution.completed",
		`"request_id":"req-terminal-stream-direct"`,
		`"trace_id":"trace-terminal-stream-direct"`,
		`"status":"completed"`,
		`"outcome":"supervisor_response"`,
		`"status":"no_answer"`,
	} {
		if !strings.Contains(body, snippet) {
			t.Fatalf("stream body missing %q:\n%s", snippet, body)
		}
	}
}

func TestAnswerStreamBridgeNotConfiguredEmitsTelemetryAndExecutionAudit(t *testing.T) {
	telemetryServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
	}))
	defer telemetryServer.Close()

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
		AuthMode:                   "bearer",
		BearerToken:                "secret-token",
		DefaultActorID:             "runtime-bearer-user",
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL + "/api/internal/execution/audit-events",
		OTelEnabled:                true,
		OTelEndpoint:               telemetryServer.URL,
		OTelSampleRatio:            1,
		RequestBodyLimitBytes:      1_048_576,
		MaxConcurrentAnswers:       8,
	}, nil)
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		delegateAnswerBody("req-stream-bridge-not-configured-audit"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: execution.failed") ||
		!strings.Contains(body, `"code":"bridge_not_configured"`) {
		t.Fatalf("stream body missing bridge_not_configured failure:\n%s", body)
	}
	status := server.telemetry.Status()
	if status.ExportedCount != 1 {
		t.Fatalf("telemetry exported count = %d, want 1", status.ExportedCount)
	}
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
		if event["event_type"] != "execution.bridge_failed" {
			t.Fatalf("event_type = %v, want execution.bridge_failed", event["event_type"])
		}
		if event["failure_kind"] != "bridge_not_configured" {
			t.Fatalf("failure_kind = %v, want bridge_not_configured", event["failure_kind"])
		}
		if event["http_status"] != float64(http.StatusServiceUnavailable) {
			t.Fatalf("http_status = %v, want 503", event["http_status"])
		}
		if event["retryable"] != true {
			t.Fatalf("retryable = %v, want true", event["retryable"])
		}
		if event["request_id"] != "req-stream-bridge-not-configured-audit" {
			t.Fatalf("request_id = %v", event["request_id"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerStreamDelegatesOpenedStructuredRuntimeToAgentsSdkAdmittedBridge(t *testing.T) {
	bridgeCalls := 0
	server := NewServer(config.Config{
		AuthMode:                          "bearer",
		BearerToken:                       "secret-token",
		DefaultActorID:                    "runtime-bearer-user",
		RequestBodyLimitBytes:             1_048_576,
		MaxConcurrentAnswers:              8,
		OpenCapabilities:                  []string{"campus_services"},
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T20:30:00+08:00",
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			payload := decodeJSONRecord(t, request.Payload)
			runtimeDecisions := expectRecord(t, payload["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, runtimeDecisions["handoff"], "runtime_decisions.handoff")
			allowedTools, ok := handoff["allowed_tools"].([]any)
			if !ok || len(allowedTools) != 1 || allowedTools[0] != "transport_schedule_lookup" {
				t.Fatalf("handoff.allowed_tools = %#v, want transport_schedule_lookup", handoff["allowed_tools"])
			}
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"两校区通勤班车下一班 06:50 发车。","agent_observability":{"selected_tool":"transport_schedule_lookup","tool_attempted":true,"tool_outcome":"sdk_completed","result_outcome":"resolved_current","source_ref_count":1,"safe_details":{"agent_execution_projection":{"schema_version":"agent-execution-projection-v1","projection_owner":"campus-services-agent","selected_tool":"transport_schedule_lookup","payload_kind":"transport_schedule_lookup","tool_selection_reason":"agents_sdk_adapter"},"result_guardrail":{"schema_version":"agent-result-guardrail-v1","outcome":"source_backed","source_ref_count":1,"access_decision":"allowed"}}}}`),
			}, nil
		},
	})
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"我明天早上要去丰台上课，最早的班车是几点","request_id":"req-structured-stream-direct"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-structured-stream-direct")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 1 {
		t.Fatalf("bridge calls = %d, want 1", bridgeCalls)
	}
	body := response.Body.String()
	for _, snippet := range []string{
		"event: execution.started",
		"event: execution.running",
		"event: execution.completed",
		`"request_id":"req-structured-stream-direct"`,
		`"trace_id":"trace-structured-stream-direct"`,
		`"selected_target":"campus-services-agent"`,
		`"status":"completed"`,
		`"outcome":"supervisor_response"`,
		`"workflow_mode":"single_handoff"`,
		`"selected_tool":"transport_schedule_lookup"`,
		`"tool_outcome":"sdk_completed"`,
	} {
		if !strings.Contains(body, snippet) {
			t.Fatalf("stream body missing %q:\n%s", snippet, body)
		}
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
			Kind:       "agent_response",
			Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		delegateAnswerBody("req-stream-success"),
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

func TestAnswerStreamRejectsSupervisorResponseWithNon2xxStatus(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusInternalServerError,
			Kind:       "agent_response",
			Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		delegateAnswerBody("req-stream-response-status-mismatch"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("stream status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: execution.failed") ||
		!strings.Contains(body, `"code":"supervisor_bridge_invalid_response"`) ||
		strings.Contains(body, "event: execution.completed") {
		t.Fatalf("stream body missing invalid bridge response failure:\n%s", body)
	}
}

func TestAnswerStreamRejectsSupervisorErrorWith2xxStatus(t *testing.T) {
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
			Kind:       "supervisor_error",
			Body:       json.RawMessage(`{"error":{"code":"bad_bridge","message":"bad","retryable":true}}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		delegateAnswerBody("req-stream-error-status-mismatch"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("stream status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: execution.failed") ||
		!strings.Contains(body, `"code":"supervisor_bridge_invalid_response"`) ||
		strings.Contains(body, "event: execution.completed") {
		t.Fatalf("stream body missing invalid bridge error failure:\n%s", body)
	}
}

func TestAnswerStreamRejectsClosedStructuredRuntimeBeforeBridge(t *testing.T) {
	bridgeCalls := 0
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"notice-agent","status":"completed","answer_text":"ok"}`),
			}, nil
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"找一下春假通知","request_id":"req-stream-structured-closed"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("stream status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 0 {
		t.Fatalf("bridge calls = %d, want 0", bridgeCalls)
	}
	body := response.Body.String()
	if !strings.Contains(body, "event: execution.failed") ||
		!strings.Contains(body, `"code":"structured_runtime_closed"`) ||
		!strings.Contains(body, `"outcome":"structured_runtime_closed"`) {
		t.Fatalf("stream body missing structured runtime closed failure:\n%s", body)
	}
}

func TestAnswerStreamClosedStructuredRuntimeEmitsTelemetry(t *testing.T) {
	otelServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(otelServer.Close)

	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OTelEnabled:           true,
		OTelEndpoint:          otelServer.URL,
		OTelSampleRatio:       1,
	}, &fakeBridge{configured: true})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		strings.NewReader(`{"user_goal":"找一下春假通知","request_id":"req-stream-structured-closed-telemetry"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	status := server.telemetry.Status()
	if status.ExportedCount != 1 {
		t.Fatalf("telemetry exported count = %d, want 1", status.ExportedCount)
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
		delegateAnswerBody("req-stream-breaker-first"),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	server.ServeHTTP(firstResponse, firstRequest)
	assertError(t, firstResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	streamRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer/stream",
		delegateAnswerBody("req-stream-breaker-open"),
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
