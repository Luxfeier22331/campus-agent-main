package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
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

func TestEmitterBatchesEventsBeforePosting(t *testing.T) {
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
		ExecutionAuditBatchSize:        2,
		ExecutionAuditEnabled:          true,
		ExecutionAuditFlushMS:          10_000,
		ExecutionAuditQueueCapacity:    4,
		ExecutionAuditRetryBaseMS:      1,
		ExecutionAuditRetryMaxAttempts: 1,
		ExecutionAuditSharedSecret:     "audit-secret",
		ExecutionAuditTimeoutMS:        500,
		ExecutionAuditURL:              auditServer.URL,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	defer func() {
		_ = emitter.Shutdown(context.Background())
	}()

	emitter.Emit(context.Background(), Event{EventType: "execution.cancelled", RequestID: "req-001", TraceID: "trace-001"})
	emitter.Emit(context.Background(), Event{EventType: "execution.bridge_failed", RequestID: "req-002", TraceID: "trace-002"})

	select {
	case body := <-received:
		events, ok := body["events"].([]any)
		if !ok || len(events) != 2 {
			t.Fatalf("events = %#v, want two events", body["events"])
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for batched audit events")
	}
	status := emitter.Status()
	if status.BatchSize != 2 {
		t.Fatalf("batch size = %d, want 2", status.BatchSize)
	}
}

func TestEmitterRetriesFailedBatchBeforeSuccess(t *testing.T) {
	attempts := 0
	received := make(chan struct{}, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		attempts++
		if attempts == 1 {
			response.WriteHeader(http.StatusBadGateway)
			return
		}
		received <- struct{}{}
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditBatchSize:        1,
		ExecutionAuditEnabled:          true,
		ExecutionAuditFlushMS:          10_000,
		ExecutionAuditQueueCapacity:    4,
		ExecutionAuditRetryBaseMS:      1,
		ExecutionAuditRetryMaxAttempts: 2,
		ExecutionAuditSharedSecret:     "audit-secret",
		ExecutionAuditTimeoutMS:        500,
		ExecutionAuditURL:              auditServer.URL,
	}, nil)
	defer func() {
		_ = emitter.Shutdown(context.Background())
	}()

	emitter.Emit(context.Background(), Event{EventType: "execution.timed_out", RequestID: "req-retry", TraceID: "trace-retry"})

	select {
	case <-received:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for retried audit delivery")
	}
	status := emitter.Status()
	if status.RetriedCount != 1 {
		t.Fatalf("retried count = %d, want 1", status.RetriedCount)
	}
}

func TestEmitterSpoolsFailedBatchAfterRetryExhaustion(t *testing.T) {
	spoolDir := t.TempDir()
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusBadGateway)
	}))
	defer auditServer.Close()

	emitter := NewEmitter(context.Background(), config.Config{
		ExecutionAuditBatchSize:        1,
		ExecutionAuditEnabled:          true,
		ExecutionAuditFlushMS:          10_000,
		ExecutionAuditQueueCapacity:    4,
		ExecutionAuditRetryBaseMS:      1,
		ExecutionAuditRetryMaxAttempts: 1,
		ExecutionAuditSharedSecret:     "audit-secret",
		ExecutionAuditSpoolDir:         spoolDir,
		ExecutionAuditSpoolMaxBytes:    4096,
		ExecutionAuditTimeoutMS:        500,
		ExecutionAuditURL:              auditServer.URL,
	}, nil)
	defer func() {
		_ = emitter.Shutdown(context.Background())
	}()

	emitter.Emit(context.Background(), Event{EventType: "execution.bridge_failed", RequestID: "req-spool", TraceID: "trace-spool"})

	deadline := time.After(time.Second)
	for {
		status := emitter.Status()
		if status.SpooledCount == 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for spool status: %#v", status)
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	matches, err := filepath.Glob(filepath.Join(spoolDir, "*.jsonl"))
	if err != nil {
		t.Fatalf("glob spool dir: %v", err)
	}
	if len(matches) == 0 {
		t.Fatal("expected a spool jsonl file")
	}
	raw, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read spool file: %v", err)
	}
	if !strings.Contains(string(raw), "req-spool") {
		t.Fatalf("spool file missing request id: %s", string(raw))
	}
}

func TestEmitterUnavailableLogUsesSupervisorAPIEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))

	_ = NewEmitter(context.Background(), config.Config{
		ExecutionAuditEnabled: true,
	}, logger)

	logged := logBuffer.String()
	if !strings.Contains(logged, "supervisor_api.execution_audit_unavailable") {
		t.Fatalf("log output = %q, want supervisor_api.execution_audit_unavailable", logged)
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
		ExecutionAuditBatchSize:     1,
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
		if event["event_id"] != "supervisor-api:req-001:execution.bridge_failed" {
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
