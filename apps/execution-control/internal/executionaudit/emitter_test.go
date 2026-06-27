package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestEmitterDisabledNoops(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{}, nil)

	if err := emitter.Emit(context.Background(), Event{
		EventType: "execution.activity_failed",
		RequestID: "req-001",
		TraceID:   "trace-001",
	}); err != nil {
		t.Fatalf("disabled emitter returned error: %v", err)
	}

	status := emitter.Status()
	if status.Enabled {
		t.Fatal("enabled = true, want false")
	}
	if status.EmittedCount != 0 || status.FailedCount != 0 {
		t.Fatalf("unexpected disabled status: %#v", status)
	}
}

func TestEmitterStatusRedactsDeliveryErrorDetails(t *testing.T) {
	emitter := &Emitter{
		enabled:   true,
		lastError: "Post https://audit.example.test/ingest?token=secret-token: dial tcp 127.0.0.1:9443: connect: connection refused",
	}

	status := emitter.Status()

	if status.LastError != "execution audit delivery error" {
		t.Fatalf("last error = %q", status.LastError)
	}
	for _, secret := range []string{"secret-token", "127.0.0.1:9443", "audit.example.test"} {
		if strings.Contains(status.LastError, secret) {
			t.Fatalf("last error leaked %q: %s", secret, status.LastError)
		}
	}
}

func TestEmitterEmitFailsWhenDeliveryFails(t *testing.T) {
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusBadGateway)
	}))
	defer auditServer.Close()

	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, nil)

	err := emitter.Emit(context.Background(), Event{
		EventType: "execution.activity_failed",
		RequestID: "req-audit-failed",
		TraceID:   "trace-audit-failed",
	})

	if err == nil {
		t.Fatal("expected audit delivery failure to return an error")
	}
	status := emitter.Status()
	if status.EmittedCount != 0 || status.FailedCount != 1 {
		t.Fatalf("unexpected status after failed delivery: %#v", status)
	}
}

func TestEmitterEmitFailsWhenEnabledButUnconfigured(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled: true,
	}, nil)

	err := emitter.Emit(context.Background(), Event{
		EventType: "execution.activity_failed",
		RequestID: "req-audit-unconfigured",
		TraceID:   "trace-audit-unconfigured",
	})

	if err == nil {
		t.Fatal("expected unconfigured enabled audit emitter to return an error")
	}
	status := emitter.Status()
	if status.Enabled != true || status.Configured != false || status.FailedCount != 1 {
		t.Fatalf("unexpected unconfigured status: %#v", status)
	}
}

func TestEmitterPostsEachEventSynchronously(t *testing.T) {
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

	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := emitter.Emit(context.Background(), Event{EventType: "execution.cancelled", RequestID: "req-001", TraceID: "trace-001"}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	select {
	case body := <-received:
		events, ok := body["events"].([]any)
		if !ok || len(events) != 1 {
			t.Fatalf("events = %#v, want one event", body["events"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for audit event")
	}
	status := emitter.Status()
	if status.EmittedCount != 1 {
		t.Fatalf("emitted count = %d, want 1", status.EmittedCount)
	}
}

func TestEmitterUnavailableLogUsesExecutionControlEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))

	_ = NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled: true,
	}, logger)

	logged := logBuffer.String()
	if !strings.Contains(logged, "execution_control.execution_audit_unavailable") {
		t.Fatalf("log output = %q, want execution_control.execution_audit_unavailable", logged)
	}
	staleNamespace := "go_" + "shell."
	if strings.Contains(logged, staleNamespace) {
		t.Fatalf("log output = %q, must not contain stale namespace", logged)
	}
}

func TestEmitterPostsSafeExecutionAuditEvent(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
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

	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := emitter.Emit(context.Background(), Event{
		ActivityDuration:      35 * time.Second,
		ContextPreflightState: "not_follow_up",
		Decision:              "queue_full",
		Duration:              35*time.Second + 12*time.Millisecond,
		EventType:             "execution.activity_failed",
		FailureKind:           "timeout",
		HTTPStatus:            http.StatusGatewayTimeout,
		OccurredAt:            time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC),
		PlanningOutcome:       "not_preplanned",
		PolicyGateDecision:    "out_of_scope",
		QueueWait:             12 * time.Millisecond,
		RequestID:             "req-001",
		RequestedTool:         "knowledge_query",
		Retryable:             true,
		RoutingNextAction:     "out_of_scope",
		ScopeGateDecision:     "out_of_scope",
		TerminalOutcome:       "no_answer",
		FailCloseReason:       "product_scope_boundary",
		TraceID:               "trace-001",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
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
		if event["event_id"] != "execution-control:req-001:execution.activity_failed" {
			t.Fatalf("event_id = %v", event["event_id"])
		}
		if event["event_type"] != "execution.activity_failed" || event["request_id"] != "req-001" {
			t.Fatalf("unexpected event payload: %#v", event)
		}
		if _, ok := event["user_goal"]; ok {
			t.Fatal("audit event must not include raw user_goal")
		}
		expectedRuntimeFields := map[string]string{
			"scope_gate_decision":     "out_of_scope",
			"policy_gate_decision":    "out_of_scope",
			"context_preflight_state": "not_follow_up",
			"routing_next_action":     "out_of_scope",
			"planning_outcome":        "not_preplanned",
			"terminal_outcome":        "no_answer",
			"fail_close_reason":       "product_scope_boundary",
		}
		for key, want := range expectedRuntimeFields {
			if event[key] != want {
				t.Fatalf("audit field %s = %v, want %q", key, event[key], want)
			}
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for audit event")
	}
}
