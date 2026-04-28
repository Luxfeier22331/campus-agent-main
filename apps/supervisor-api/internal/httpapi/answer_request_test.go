package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

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

func TestAnswerRejectsUnreadableBodySeparatelyFromBodyTooLarge(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/api/v1/answer", nil)
	request.Body = failingReadCloser{}

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "request_body_unreadable")
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
		delegateAnswerBody("req-bridge-missing"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "bridge_not_configured")
}

func TestAnswerBridgeNotConfiguredEmitsTelemetryAndExecutionAudit(t *testing.T) {
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
		AuthMode:                    "bearer",
		BearerToken:                 "secret-token",
		DefaultActorID:              "runtime-bearer-user",
		ExecutionAuditBatchSize:     1,
		ExecutionAuditEnabled:       true,
		ExecutionAuditQueueCapacity: 4,
		ExecutionAuditSharedSecret:  "audit-secret",
		ExecutionAuditTimeoutMS:     500,
		ExecutionAuditURL:           auditServer.URL + "/api/internal/execution/audit-events",
		OTelEnabled:                 true,
		OTelEndpoint:                telemetryServer.URL,
		OTelSampleRatio:             1,
		RequestBodyLimitBytes:       1_048_576,
		MaxConcurrentAnswers:        8,
	}, nil)
	defer func() {
		_ = server.Shutdown(context.Background())
	}()

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-not-configured-audit"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "bridge_not_configured")
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
		if event["request_id"] != "req-bridge-not-configured-audit" {
			t.Fatalf("request_id = %v", event["request_id"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerRejectsClosedStructuredRuntimeBeforeBridge(t *testing.T) {
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
				Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"ok"}`),
			}, nil
		},
	})
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"校车什么时候发车","request_id":"req-structured-closed"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-structured-closed")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "structured_runtime_closed")
	if bridgeCalls != 0 {
		t.Fatalf("bridge calls = %d, want 0", bridgeCalls)
	}
	body := decodeBody(t, response)
	if body["request_id"] != "req-structured-closed" {
		t.Fatalf("request_id = %v, want req-structured-closed", body["request_id"])
	}
	if body["trace_id"] != "trace-structured-closed" {
		t.Fatalf("trace_id = %v, want trace-structured-closed", body["trace_id"])
	}
	if body["failure_kind"] != "structured_runtime_closed" {
		t.Fatalf("failure_kind = %v, want structured_runtime_closed", body["failure_kind"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_supervisor_api_capability_gate_decisions_total{capability="campus_services",gate="structured_runtime",decision="closed"} 1`,
	) {
		t.Fatalf("metrics missing structured runtime gate rejection:\n%s", metricsResponse.Body.String())
	}
}

func TestAnswerRecordsRuntimePolicyDecisionMetricsBeforeBridge(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			t.Fatal("terminal runtime policy response must not call Python bridge")
			return bridge.ExecuteResponse{}, nil
		},
	})
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"MIT的校长是谁","request_id":"req-runtime-policy-metrics"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["status"] != "no_answer" {
		t.Fatalf("status body = %v, want no_answer", body["status"])
	}
	if body["trace_id"] == "" {
		t.Fatalf("trace_id must be injected into terminal response: %#v", body)
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	expectedMetric := `campus_supervisor_api_runtime_policy_decisions_total{capability="knowledge",lane="rag",scope_gate="out_of_scope",policy_gate="out_of_scope",context_preflight="not_follow_up",routing_next_action="out_of_scope",planning_outcome="not_preplanned",selected_target="none",selected_tool="none",terminal_outcome="no_answer",fail_close_reason="product_scope_boundary"} 1`
	if !strings.Contains(metricsResponse.Body.String(), expectedMetric) {
		t.Fatalf("metrics missing runtime policy decision:\n%s", metricsResponse.Body.String())
	}
}

func TestAnswerAllowsOpenedStructuredRuntimeWithoutPythonBridge(t *testing.T) {
	bridgeCalls := 0
	bridgeClient := &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"bridge"}`),
			}, nil
		},
	}
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OpenCapabilities:      []string{"campus_services"},
	}, bridgeClient)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"校车什么时候发车","request_id":"req-structured-open"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 0 {
		t.Fatalf("bridge calls = %d, want 0", bridgeCalls)
	}
	body := decodeBody(t, response)
	if body["selected_target"] != "campus-services-agent" {
		t.Fatalf("selected_target = %v, want campus-services-agent", body["selected_target"])
	}
	if body["status"] != "no_answer" {
		t.Fatalf("status = %v, want no_answer", body["status"])
	}
}

func TestAnswerDirectStructuredDuplicateRequestIDReturnsConflict(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OpenCapabilities:      []string{"campus_services"},
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		`{
			"schema_version":"campus_services_projection.v1",
			"service_status_records":[{"service_id":"shuttle_bus","status":"open","source_ref":"notice:bus"}],
			"transport_schedule_snapshots":[{"snapshot_id":"snapshot:bus","is_current":true}],
			"service_guide_records":[{"service_id":"shuttle_bus","service_name":"校车","required_materials":[],"contact_refs":[]}]
		}`,
		"2026-04-24T20:30:00+08:00",
	)
	_, _, err := server.lifecycle.Register(context.Background(), lifecycle.Metadata{
		RequestID:           "req-structured-duplicate",
		Lane:                "campus_services",
		RequestedCapability: "campus_services",
	})
	if err != nil {
		t.Fatalf("register duplicate fixture: %v", err)
	}
	defer server.lifecycle.Complete("req-structured-duplicate", lifecycle.StateFailed)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"校车什么时候发车","request_id":"req-structured-duplicate"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusConflict, "execution_already_in_flight")
}

func TestAnswerExecutesOpenedStructuredRuntimeDirectlyInGo(t *testing.T) {
	projectionFixture := `{
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
	}`
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
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"bridge"}`),
			}, nil
		},
	})
	useStructuredQueryRuntimeFixture(
		t,
		server,
		projectionFixture,
		"2026-04-24T20:30:00+08:00",
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"我明天早上要去丰台上课，最早的班车是几点","request_id":"req-structured-direct"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-structured-direct")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 0 {
		t.Fatalf("bridge calls = %d, want 0", bridgeCalls)
	}
	body := decodeBody(t, response)
	if body["selected_target"] != "campus-services-agent" {
		t.Fatalf("selected_target = %v, want campus-services-agent", body["selected_target"])
	}
	if body["status"] != "completed" {
		t.Fatalf("status = %v, want completed", body["status"])
	}
	if body["trace_id"] != "trace-structured-direct" {
		t.Fatalf("trace_id = %v, want trace-structured-direct", body["trace_id"])
	}
	result := expectRecord(t, body["result"], "result")
	if result["outcome"] != "resolved_current" {
		t.Fatalf("result.outcome = %v, want resolved_current", result["outcome"])
	}
	observability := expectRecord(t, body["observability"], "observability")
	if observability["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("observability.selected_tool = %v, want transport_schedule_lookup", observability["selected_tool"])
	}
}

func TestAnswerUsesStartupIntentPolicySnapshot(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load default intent policy: %v", err)
	}
	rawPolicy, err := json.Marshal(policy)
	if err != nil {
		t.Fatalf("marshal intent policy: %v", err)
	}
	policyPath := t.TempDir() + "/intent-policy.v1.json"
	if err := os.WriteFile(policyPath, rawPolicy, 0o600); err != nil {
		t.Fatalf("write intent policy fixture: %v", err)
	}
	t.Setenv("SUPERVISOR_API_INTENT_POLICY_PATH", policyPath)

	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OpenCapabilities:      []string{"campus_services"},
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		`{
			"schema_version":"campus_services_projection.v1",
			"service_status_records":[{"service_id":"shuttle_bus","status":"open","source_ref":"notice:bus"}],
			"transport_schedule_snapshots":[{"snapshot_id":"snapshot:bus","is_current":true}],
			"service_guide_records":[{"service_id":"shuttle_bus","service_name":"校车","required_materials":[],"contact_refs":[]}]
		}`,
		"2026-04-24T20:30:00+08:00",
	)
	if err := os.Remove(policyPath); err != nil {
		t.Fatalf("remove intent policy fixture after startup: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"校车什么时候发车","request_id":"req-intent-policy-snapshot"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["selected_target"] != "campus-services-agent" {
		t.Fatalf("selected_target = %v, want campus-services-agent", body["selected_target"])
	}
}
