package telemetry

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel/propagation"
	oteltrace "go.opentelemetry.io/otel/trace"
)

const (
	headerTraceParent = "traceparent"
	headerRequestID   = "x-request-id"
	headerTraceID     = "x-trace-id"
)

var runtimeTextMapPropagator propagation.TextMapPropagator = propagation.TraceContext{}

func ExtractIncomingContext(ctx context.Context, headers http.Header) context.Context {
	return ExtractTraceParent(ctx, headers.Get(headerTraceParent))
}

func ExtractTraceParent(ctx context.Context, traceParent string) context.Context {
	carrier := propagation.HeaderCarrier{}
	if value := strings.TrimSpace(traceParent); value != "" {
		carrier.Set(headerTraceParent, value)
	}
	cleanContext := oteltrace.ContextWithSpanContext(ctx, oteltrace.SpanContext{})
	return runtimeTextMapPropagator.Extract(cleanContext, carrier)
}

func InjectExecutionTraceHeaders(ctx context.Context, requestID string, traceID string) map[string]string {
	if ctx == nil {
		ctx = context.Background()
	}
	headers := http.Header{}
	runtimeTextMapPropagator.Inject(ctx, propagation.HeaderCarrier(headers))

	traceHeaders := map[string]string{}
	if value := strings.TrimSpace(headers.Get(headerTraceParent)); value != "" {
		traceHeaders[headerTraceParent] = value
	}
	if value := strings.TrimSpace(requestID); value != "" {
		traceHeaders[headerRequestID] = value
	}
	if value := strings.TrimSpace(traceID); value != "" {
		traceHeaders[headerTraceID] = value
	}
	return traceHeaders
}
