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

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestAnswerDelegatesProjectedPayloadAndInjectsTraceID(t *testing.T) {
	bridgeClient := &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "agent_response",
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

func TestAnswerPropagatesTraceHeadersToBridge(t *testing.T) {
	bridgeClient := &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "agent_response",
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
			"request_id":"req-trace-propagation",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"}
		}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("sentry-trace", "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1")
	request.Header.Set("baggage", "release=phase1")
	request.Header.Set("x-trace-id", "trace-product-001")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	traceHeaders := bridgeClient.seen.TraceHeaders
	if traceHeaders["traceparent"] != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Fatalf("traceparent = %q", traceHeaders["traceparent"])
	}
	if traceHeaders["baggage"] != "release=phase1" {
		t.Fatalf("baggage = %q", traceHeaders["baggage"])
	}
	if traceHeaders["x-request-id"] != "req-trace-propagation" {
		t.Fatalf("x-request-id = %q", traceHeaders["x-request-id"])
	}
	if traceHeaders["x-trace-id"] != "trace-product-001" {
		t.Fatalf("x-trace-id = %q", traceHeaders["x-trace-id"])
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
		delegateAnswerBody("req-supervisor-error"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusForbidden, "disallowed_knowledge_scope")
}

func TestAnswerFinalizesAgentBridgeResponseInGo(t *testing.T) {
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
			Body: json.RawMessage(`{
				"target":"rag-agent",
				"status":"completed",
				"answer_text":"Go finalized this agent response.",
				"confidence":"high",
				"result":{
					"evidence":{
						"sources":[{"doc_id":"handbook:test-001"}]
					},
					"diagnostics":{
						"retrieved_sources":[{"doc_id":"handbook:test-001"}]
					}
				}
			}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-agent-response"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-agent-response")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	payload := decodeBody(t, response)
	if payload["selected_target"] != "rag-agent" {
		t.Fatalf("selected_target = %v, want rag-agent", payload["selected_target"])
	}
	if payload["answer_text"] != "Go finalized this agent response." {
		t.Fatalf("answer_text = %v", payload["answer_text"])
	}
	if payload["trace_id"] != "trace-agent-response" {
		t.Fatalf("trace_id = %v, want trace-agent-response", payload["trace_id"])
	}
	observability := expectRecord(t, payload["observability"], "observability")
	if observability["semantic_outcome"] != "grounded_answer" {
		t.Fatalf("semantic_outcome = %v, want grounded_answer", observability["semantic_outcome"])
	}
}

func TestAnswerRejectsLegacySupervisorBridgeResponseKind(t *testing.T) {
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
			Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed"}`),
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-legacy-supervisor-response"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
}

func TestAnswerRejectsSupervisorResponseWithNon2xxStatus(t *testing.T) {
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
		"/api/v1/answer",
		delegateAnswerBody("req-response-status-mismatch"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
}

func TestAnswerRejectsSupervisorErrorWith2xxStatus(t *testing.T) {
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
		"/api/v1/answer",
		delegateAnswerBody("req-error-status-mismatch"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
}

func TestAnswerMapsBridgeResponseTooLargeToInvalidResponse(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeErr: bridge.ErrResponseTooLarge,
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-response-too-large"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")

	metrics := httptest.NewRecorder()
	server.ServeHTTP(metrics, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(metrics.Body.String(), `campus_supervisor_api_bridge_failures_total{kind="invalid_response"} 1`) {
		t.Fatalf("metrics body missing invalid_response bridge failure:\n%s", metrics.Body.String())
	}
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
		delegateAnswerBody("req-bridge-cancelled"),
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
		delegateAnswerBody("req-bridge-invalid-request"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_request")
}

func TestAnswerRetriesTransientBridgeUnavailableAndRecordsRunState(t *testing.T) {
	calls := 0
	server := NewServer(config.Config{
		AuthMode:                      "bearer",
		BearerToken:                   "secret-token",
		DefaultActorID:                "runtime-bearer-user",
		RequestBodyLimitBytes:         1_048_576,
		MaxConcurrentAnswers:          8,
		BridgeRetryMaxAttempts:        2,
		BridgeRetryBaseMS:             1,
		BridgeBreakerOpenMS:           60_000,
		BridgeBreakerFailureThreshold: 5,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			calls++
			if calls == 1 {
				return bridge.ExecuteResponse{}, errors.New("connection refused")
			}
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body: json.RawMessage(`{
					"selected_target":"rag-agent",
					"status":"completed",
					"answer_text":"recovered"
				}`),
			}, nil
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-retry-recovered"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if calls != 2 {
		t.Fatalf("bridge calls = %d, want 2", calls)
	}
	body := decodeBody(t, response)
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	traceSteps, ok := traceSummary["trace_steps"].([]any)
	if !ok || len(traceSteps) == 0 {
		t.Fatalf("trace_steps = %#v, want non-empty list", traceSummary["trace_steps"])
	}
	finalization := expectRecord(t, traceSteps[len(traceSteps)-1], "trace_steps[-1]")
	if finalization["attempt_count"] != float64(2) {
		t.Fatalf("finalization attempt_count = %v, want 2", finalization["attempt_count"])
	}
	if finalization["runtime_retry_count"] != float64(1) {
		t.Fatalf("finalization runtime_retry_count = %v, want 1", finalization["runtime_retry_count"])
	}

	metrics := httptest.NewRecorder()
	server.ServeHTTP(metrics, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(metrics.Body.String(), `campus_supervisor_api_bridge_retries_total{kind="unavailable"} 1`) {
		t.Fatalf("metrics body missing unavailable bridge retry:\n%s", metrics.Body.String())
	}
}

func TestAnswerDoesNotRetryBridgeInvalidRequestResponse(t *testing.T) {
	calls := 0
	server := NewServer(config.Config{
		AuthMode:               "bearer",
		BearerToken:            "secret-token",
		DefaultActorID:         "runtime-bearer-user",
		RequestBodyLimitBytes:  1_048_576,
		MaxConcurrentAnswers:   8,
		BridgeRetryMaxAttempts: 3,
		BridgeRetryBaseMS:      1,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			calls++
			return bridge.ExecuteResponse{
				StatusCode: http.StatusBadRequest,
				Kind:       "bridge_invalid_request",
				Body:       json.RawMessage(`{"error":{"code":"invalid_request","message":"bad"}}`),
			}, nil
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-invalid-request-no-retry"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_request")
	if calls != 1 {
		t.Fatalf("bridge calls = %d, want 1", calls)
	}
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
		delegateAnswerBody("req-missing-bridge-envelope"),
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
		delegateAnswerBody("req-breaker-first"),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	server.ServeHTTP(firstResponse, firstRequest)
	assertError(t, firstResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	secondRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-breaker-open"),
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
		delegateAnswerBody("req-audit-bridge-protocol"),
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
		delegateAnswerBody("req-bridge-timeout"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusGatewayTimeout, "supervisor_bridge_timeout")
}

func TestAnswerRedactsBridgeTransportError(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeErr: errors.New("dial http://internal-host:1234/secret?token=raw-token: connection refused"),
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-redaction"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_unavailable")
	body := response.Body.String()
	if !strings.Contains(body, "Supervisor Python bridge is unavailable.") {
		t.Fatalf("response body missing sanitized bridge message: %s", body)
	}
	for _, secret := range []string{"internal-host", "/secret", "raw-token"} {
		if strings.Contains(body, secret) {
			t.Fatalf("response body leaked bridge error detail %q: %s", secret, body)
		}
	}
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
		delegateAnswerBody("req-client-cancelled"),
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
