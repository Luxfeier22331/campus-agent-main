package telemetry

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestEmitterDisabledNoops(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{}, nil)

	emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-001",
		TraceID:   "trace-001",
	})

	status := emitter.Status()
	if status.Enabled {
		t.Fatal("enabled = true, want false")
	}
	if status.DroppedCount != 0 {
		t.Fatalf("dropped count = %d, want 0", status.DroppedCount)
	}
}

func TestEmitterEnabledWithoutEndpointFailsOpen(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{
		OTelEnabled: true,
	}, nil)

	emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-001",
		TraceID:   "trace-001",
	})

	status := emitter.Status()
	if !status.Enabled {
		t.Fatal("enabled = false, want true")
	}
	if status.ExporterConfigured {
		t.Fatal("exporter configured = true, want false")
	}
	if status.LastError == "" {
		t.Fatal("last error should be populated")
	}
	if status.DroppedCount != 1 {
		t.Fatalf("dropped count = %d, want 1", status.DroppedCount)
	}
}

func TestEmitterUnavailableLogUsesSupervisorAPIEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))

	_ = NewEmitter(context.Background(), config.Config{
		OTelEnabled: true,
	}, logger)

	logged := logBuffer.String()
	if !strings.Contains(logged, "supervisor_api.telemetry_unavailable") {
		t.Fatalf("log output = %q, want supervisor_api.telemetry_unavailable", logged)
	}
	staleNamespace := "go_" + "shell."
	if strings.Contains(logged, staleNamespace) {
		t.Fatalf("log output = %q, must not contain stale namespace", logged)
	}
}

func TestEmitterSpanUsesSupervisorAPINamespace(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1.0,
		tracer:      provider.Tracer("test"),
	}

	emitter.Emit(context.Background(), Event{
		Name:     "answer.accepted",
		Duration: 15 * time.Millisecond,
	})

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	if spans[0].Name() != "supervisor_api.answer.accepted" {
		t.Fatalf("span name = %q, want supervisor_api.answer.accepted", spans[0].Name())
	}
}

func TestEmitterSamplesOutEvents(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 0,
		tracer:      provider.Tracer("test"),
	}

	emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-sampled-out",
	})

	if len(recorder.Ended()) != 0 {
		t.Fatalf("ended spans = %d, want 0", len(recorder.Ended()))
	}
	status := emitter.Status()
	if status.DroppedCount != 1 {
		t.Fatalf("dropped count = %d, want 1", status.DroppedCount)
	}
}

func TestEmitterUsesAllowlistedAttributesOnly(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1,
		tracer:      provider.Tracer("test"),
	}

	emitter.Emit(context.Background(), Event{
		BridgeDuration:      25 * time.Millisecond,
		Decision:            "admitted_immediate",
		Duration:            50 * time.Millisecond,
		FailureCode:         "timeout",
		Lane:                "rag",
		Name:                "answer.failed",
		Outcome:             "supervisor_bridge_timeout",
		QueueWait:           5 * time.Millisecond,
		RequestID:           "req-attrs",
		RequestedCapability: "knowledge",
		StatusCode:          504,
		TraceID:             "trace-attrs",
	})

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	attrs := spans[0].Attributes()
	allowed := map[string]bool{
		"bridge_duration_ms":   true,
		"decision":             true,
		"duration_ms":          true,
		"failure_code":         true,
		"lane":                 true,
		"outcome":              true,
		"queue_wait_ms":        true,
		"request_id":           true,
		"requested_capability": true,
		"status_code":          true,
		"trace_id":             true,
	}
	for _, attr := range attrs {
		if !allowed[string(attr.Key)] {
			t.Fatalf("unexpected telemetry attribute %q", attr.Key)
		}
	}
	status := emitter.Status()
	if status.ExportedCount != 1 {
		t.Fatalf("exported count = %d, want 1", status.ExportedCount)
	}
}
