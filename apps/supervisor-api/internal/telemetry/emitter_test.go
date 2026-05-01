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

func TestEmitterStatusRedactsTransportErrorDetails(t *testing.T) {
	emitter := &Emitter{
		enabled:   true,
		lastError: "Post https://otel.example.test/v1/traces?token=secret-token: dial tcp 127.0.0.1:4318: connect: connection refused",
	}

	status := emitter.Status()

	if status.LastError != "telemetry exporter error" {
		t.Fatalf("last error = %q", status.LastError)
	}
	for _, secret := range []string{"secret-token", "127.0.0.1:4318", "otel.example.test"} {
		if strings.Contains(status.LastError, secret) {
			t.Fatalf("last error leaked %q: %s", secret, status.LastError)
		}
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
	if spans[0].Name() != "supervisor_api.runtime.request.accepted" {
		t.Fatalf("span name = %q, want supervisor_api.runtime.request.accepted", spans[0].Name())
	}
}

func TestEmitterPreservesIncomingTraceParent(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1,
		tracer:      provider.Tracer("test"),
	}
	ctx := ExtractIncomingContext(
		context.Background(),
		map[string][]string{
			"traceparent": {"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
		},
	)

	emitter.Emit(ctx, Event{Name: "agent.bridge.started"})

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	if spans[0].SpanContext().TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("trace id = %s, want propagated trace id", spans[0].SpanContext().TraceID())
	}
	if spans[0].Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Fatalf("parent span id = %s, want propagated parent", spans[0].Parent().SpanID())
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
		BridgeDuration:        25 * time.Millisecond,
		ContextPreflightState: "not_follow_up",
		Decision:              "admitted_immediate",
		Duration:              50 * time.Millisecond,
		FailureCode:           "timeout",
		BridgeCancelStatus:    "accepted",
		Lane:                  "rag",
		Name:                  "answer.failed",
		Outcome:               "supervisor_bridge_timeout",
		PlanningOutcome:       "not_preplanned",
		PolicyGateDecision:    "out_of_scope",
		QueueWait:             5 * time.Millisecond,
		RequestID:             "req-attrs",
		RequestedCapability:   "knowledge",
		RoutingNextAction:     "out_of_scope",
		ScopeGateDecision:     "out_of_scope",
		TerminalOutcome:       "no_answer",
		FailCloseReason:       "product_scope_boundary",
		StatusCode:            504,
		TraceID:               "trace-attrs",
	})

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	attrs := spans[0].Attributes()
	allowed := map[string]bool{
		"bridge_duration_ms":                   true,
		"bridge_cancel_status":                 true,
		"context_preflight_state":              true,
		"decision":                             true,
		"duration_ms":                          true,
		"failure_code":                         true,
		"lane":                                 true,
		"outcome":                              true,
		"planning_outcome":                     true,
		"policy_gate_decision":                 true,
		"queue_wait_ms":                        true,
		"request_id":                           true,
		"requested_capability":                 true,
		"routing_next_action":                  true,
		"selected_target":                      true,
		"selected_tool":                        true,
		"scope_gate_decision":                  true,
		"terminal_outcome":                     true,
		"fail_close_reason":                    true,
		"status_code":                          true,
		"telemetry.allowed_attributes_version": true,
		"trace_id":                             true,
	}
	found := map[string]string{}
	for _, attr := range attrs {
		if !allowed[string(attr.Key)] {
			t.Fatalf("unexpected telemetry attribute %q", attr.Key)
		}
		found[string(attr.Key)] = attr.Value.AsString()
	}
	expectedValues := map[string]string{
		"scope_gate_decision":     "out_of_scope",
		"policy_gate_decision":    "out_of_scope",
		"context_preflight_state": "not_follow_up",
		"routing_next_action":     "out_of_scope",
		"planning_outcome":        "not_preplanned",
		"terminal_outcome":        "no_answer",
		"fail_close_reason":       "product_scope_boundary",
		"bridge_cancel_status":    "accepted",
	}
	for key, want := range expectedValues {
		if found[key] != want {
			t.Fatalf("telemetry attribute %s = %q, want %q", key, found[key], want)
		}
	}
	status := emitter.Status()
	if status.ExportedCount != 1 {
		t.Fatalf("exported count = %d, want 1", status.ExportedCount)
	}
}
