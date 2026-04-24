package executionaudit

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
)

func TestEmitterDisabledNoops(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{}, nil)

	emitter.Emit(context.Background(), Event{
		EventType: "execution.bridge_failed",
		RequestID: "req-001",
		TraceID:   "trace-001",
	})

	status := emitter.Status()
	if status.Enabled {
		t.Fatal("enabled = true, want false")
	}
	if status.EmittedCount != 0 || status.DroppedCount != 0 || status.FailedCount != 0 {
		t.Fatalf("unexpected disabled status: %#v", status)
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
		ExecutionAuditEnabled:       true,
		ExecutionAuditQueueCapacity: 4,
		ExecutionAuditSharedSecret:  "audit-secret",
		ExecutionAuditTimeoutMS:     500,
		ExecutionAuditURL:           auditServer.URL,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer func() {
		_ = emitter.Shutdown(context.Background())
	}()

	emitter.Emit(context.Background(), Event{
		BridgeDuration:      35 * time.Second,
		Decision:            "queue_full",
		Duration:            35*time.Second + 12*time.Millisecond,
		EventType:           "execution.bridge_failed",
		FailureKind:         "timeout",
		HTTPStatus:          http.StatusGatewayTimeout,
		Lane:                "rag",
		OccurredAt:          time.Date(2026, 4, 24, 10, 0, 0, 0, time.UTC),
		QueueWait:           12 * time.Millisecond,
		RequestID:           "req-001",
		RequestedCapability: "knowledge",
		Retryable:           true,
		TraceID:             "trace-001",
	})

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
		if event["event_id"] != "go-shell:req-001:execution.bridge_failed" {
			t.Fatalf("event_id = %v", event["event_id"])
		}
		if event["event_type"] != "execution.bridge_failed" || event["request_id"] != "req-001" {
			t.Fatalf("unexpected event payload: %#v", event)
		}
		if _, ok := event["user_goal"]; ok {
			t.Fatal("audit event must not include raw user_goal")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for audit event")
	}
}
