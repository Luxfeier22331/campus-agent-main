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

func TestAnswerFailsClosedWhenExecutionAuditDeliveryFails(t *testing.T) {
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusBadGateway)
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
		RequestBodyLimitBytes:      1_048_576,
		MaxConcurrentAnswers:       8,
	}, nil)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-audit-delivery-failed"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "execution_audit_delivery_failed")
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

func TestAnswerRequiresBridgeForOpenedAgentsSdkAdmittedStructuredRuntime(t *testing.T) {
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
	if bridgeCalls != 1 {
		t.Fatalf("bridge calls = %d, want 1", bridgeCalls)
	}
	body := decodeBody(t, response)
	if body["selected_target"] != "campus-services-agent" {
		t.Fatalf("selected_target = %v, want campus-services-agent", body["selected_target"])
	}
	if body["status"] != "completed" {
		t.Fatalf("status = %v, want completed", body["status"])
	}
}

func TestAnswerAgentsSdkAdmittedStructuredBridgeDuplicateRequestIDReturnsConflict(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OpenCapabilities:      []string{"campus_services"},
	}, &fakeBridge{configured: true})
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

func TestAnswerDelegatesOpenedTransportScheduleToAgentsSdkAdmittedBridge(t *testing.T) {
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
			if handoff["target"] != "campus-services-agent" {
				t.Fatalf("handoff.target = %v, want campus-services-agent", handoff["target"])
			}
			allowedTools, ok := handoff["allowed_tools"].([]any)
			if !ok || len(allowedTools) != 1 || allowedTools[0] != "transport_schedule_lookup" {
				t.Fatalf("handoff.allowed_tools = %#v, want transport_schedule_lookup", handoff["allowed_tools"])
			}
			agentRequest := expectRecord(t, handoff["agent_request"], "handoff.agent_request")
			agentPayload := expectRecord(t, agentRequest["payload"], "handoff.agent_request.payload")
			if agentPayload["kind"] != "transport_schedule_lookup" {
				t.Fatalf("agent_request.payload.kind = %v, want transport_schedule_lookup", agentPayload["kind"])
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
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"我明天早上要去丰台上课，最早的班车是几点","request_id":"req-structured-direct"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-structured-direct")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 1 {
		t.Fatalf("bridge calls = %d, want 1", bridgeCalls)
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
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "single_handoff" {
		t.Fatalf("workflow_mode = %v, want single_handoff", traceSummary["workflow_mode"])
	}
	if traceSummary["selected_target"] != "campus-services-agent" {
		t.Fatalf("trace selected_target = %v, want campus-services-agent", traceSummary["selected_target"])
	}
	toolCalls, ok := traceSummary["tool_call_summaries"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one direct tool call", traceSummary["tool_call_summaries"])
	}
	toolCall := expectRecord(t, toolCalls[0], "tool_call_summary")
	if toolCall["tool_name"] != "transport_schedule_lookup" {
		t.Fatalf("tool_name = %v, want transport_schedule_lookup", toolCall["tool_name"])
	}
	if toolCall["business_outcome"] != "sdk_completed" {
		t.Fatalf("business_outcome = %v, want sdk_completed", toolCall["business_outcome"])
	}
	safeDetails := expectRecord(t, toolCall["safe_details"], "tool_call.safe_details")
	executionProjection := expectRecord(
		t,
		safeDetails["agent_execution_projection"],
		"agent_execution_projection",
	)
	if executionProjection["projection_owner"] != "campus-services-agent" ||
		executionProjection["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("agent_execution_projection = %#v", executionProjection)
	}
	resultGuardrail := expectRecord(t, safeDetails["result_guardrail"], "result_guardrail")
	if resultGuardrail["outcome"] != "source_backed" || resultGuardrail["source_ref_count"] != float64(1) {
		t.Fatalf("result_guardrail = %#v, want source_backed with one source", resultGuardrail)
	}
}

func TestAnswerDelegatesOpenedServiceStatusToAgentsSdkAdmittedBridge(t *testing.T) {
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
			if !ok || len(allowedTools) != 1 || allowedTools[0] != "service_status_lookup" {
				t.Fatalf("handoff.allowed_tools = %#v, want service_status_lookup", handoff["allowed_tools"])
			}
			agentRequest := expectRecord(t, handoff["agent_request"], "handoff.agent_request")
			agentPayload := expectRecord(t, agentRequest["payload"], "handoff.agent_request.payload")
			if agentPayload["kind"] != "service_status_lookup" {
				t.Fatalf("agent_request.payload.kind = %v, want service_status_lookup", agentPayload["kind"])
			}
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"海淀校区图书馆当前正常开放。","agent_observability":{"selected_tool":"service_status_lookup","tool_attempted":true,"tool_outcome":"sdk_completed","result_outcome":"resolved_current","source_ref_count":1,"safe_details":{"agent_execution_projection":{"schema_version":"agent-execution-projection-v1","projection_owner":"campus-services-agent","selected_tool":"service_status_lookup","payload_kind":"service_status_lookup","tool_selection_reason":"agents_sdk_adapter"},"result_guardrail":{"schema_version":"agent-result-guardrail-v1","outcome":"source_backed","source_ref_count":1,"access_decision":"allowed"}}}}`),
			}, nil
		},
	})
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"图书馆今天开门吗","request_id":"req-service-status-sdk"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-service-status-sdk")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if bridgeCalls != 1 {
		t.Fatalf("bridge calls = %d, want 1", bridgeCalls)
	}
	body := decodeBody(t, response)
	if body["selected_target"] != "campus-services-agent" {
		t.Fatalf("selected_target = %v, want campus-services-agent", body["selected_target"])
	}
	traceSummary := expectRecord(t, body["workflow_trace_summary"], "workflow_trace_summary")
	if traceSummary["workflow_mode"] != "single_handoff" {
		t.Fatalf("workflow_mode = %v, want single_handoff", traceSummary["workflow_mode"])
	}
	toolCalls, ok := traceSummary["tool_call_summaries"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one delegated tool call", traceSummary["tool_call_summaries"])
	}
	toolCall := expectRecord(t, toolCalls[0], "tool_call_summary")
	if toolCall["tool_name"] != "service_status_lookup" {
		t.Fatalf("tool_name = %v, want service_status_lookup", toolCall["tool_name"])
	}
	if toolCall["business_outcome"] != "sdk_completed" {
		t.Fatalf("business_outcome = %v, want sdk_completed", toolCall["business_outcome"])
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
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "agent_response",
			Body:       json.RawMessage(`{"selected_target":"campus-services-agent","status":"completed","answer_text":"ok"}`),
		},
	})
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
