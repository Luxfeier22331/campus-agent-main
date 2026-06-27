package telemetry

import (
	"context"
	"net/http"
	"testing"
)

func TestExtractIncomingContextAcceptsSentryTrace(t *testing.T) {
	headers := http.Header{}
	headers.Set("sentry-trace", "4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1")

	traceHeaders := InjectExecutionTraceHeaders(
		ExtractIncomingContext(context.Background(), headers),
		"req-001",
		"trace-001",
	)

	if traceHeaders["traceparent"] != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Fatalf("traceparent = %q", traceHeaders["traceparent"])
	}
	if traceHeaders["x-request-id"] != "req-001" {
		t.Fatalf("x-request-id = %q", traceHeaders["x-request-id"])
	}
	if traceHeaders["x-trace-id"] != "trace-001" {
		t.Fatalf("x-trace-id = %q", traceHeaders["x-trace-id"])
	}
}

func TestExtractIncomingContextIgnoresInvalidSentryTrace(t *testing.T) {
	headers := http.Header{}
	headers.Set("sentry-trace", "invalid-secret-token")

	traceHeaders := InjectExecutionTraceHeaders(
		ExtractIncomingContext(context.Background(), headers),
		"req-001",
		"trace-001",
	)

	if traceHeaders["traceparent"] != "" {
		t.Fatalf("traceparent = %q, want empty", traceHeaders["traceparent"])
	}
}
