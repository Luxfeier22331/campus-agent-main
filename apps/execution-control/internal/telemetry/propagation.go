package telemetry

import (
	"context"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
)

const (
	headerBaggage     = "baggage"
	headerSentryTrace = "sentry-trace"
	headerTraceParent = "traceparent"
	headerRequestID   = "x-request-id"
	headerTraceID     = "x-trace-id"
)

var runtimeTextMapPropagator = propagation.NewCompositeTextMapPropagator(
	propagation.TraceContext{},
	propagation.Baggage{},
)

func init() {
	otel.SetTextMapPropagator(runtimeTextMapPropagator)
}

func ExtractIncomingContext(ctx context.Context, headers http.Header) context.Context {
	carrier := propagation.HeaderCarrier(cloneTraceHeaders(headers))
	if carrier.Get(headerTraceParent) == "" {
		if traceParent := sentryTraceToTraceParent(carrier.Get(headerSentryTrace)); traceParent != "" {
			carrier.Set(headerTraceParent, traceParent)
		}
	}
	return runtimeTextMapPropagator.Extract(ctx, carrier)
}

func InjectRuntimeTraceHeaders(ctx context.Context, requestID string, traceID string) map[string]string {
	headers := http.Header{}
	runtimeTextMapPropagator.Inject(ctx, propagation.HeaderCarrier(headers))

	traceHeaders := map[string]string{}
	if value := strings.TrimSpace(headers.Get(headerTraceParent)); value != "" {
		traceHeaders[headerTraceParent] = value
	}
	if value := strings.TrimSpace(headers.Get(headerBaggage)); value != "" {
		traceHeaders[headerBaggage] = value
	}
	if value := strings.TrimSpace(requestID); value != "" {
		traceHeaders[headerRequestID] = value
	}
	if value := strings.TrimSpace(traceID); value != "" {
		traceHeaders[headerTraceID] = value
	}
	return traceHeaders
}

func cloneTraceHeaders(headers http.Header) http.Header {
	cloned := http.Header{}
	for _, name := range []string{headerTraceParent, headerBaggage, headerSentryTrace} {
		if value := firstHeaderValue(headers, name); value != "" {
			cloned.Set(name, value)
		}
	}
	return cloned
}

func firstHeaderValue(headers http.Header, name string) string {
	if value := strings.TrimSpace(headers.Get(name)); value != "" {
		return value
	}
	for key, values := range headers {
		if !strings.EqualFold(key, name) || len(values) == 0 {
			continue
		}
		return strings.TrimSpace(values[0])
	}
	return ""
}

func sentryTraceToTraceParent(value string) string {
	parts := strings.Split(strings.TrimSpace(value), "-")
	if len(parts) < 2 {
		return ""
	}
	traceID := strings.ToLower(strings.TrimSpace(parts[0]))
	spanID := strings.ToLower(strings.TrimSpace(parts[1]))
	if !isLowerHex(traceID, 32) || !isLowerHex(spanID, 16) {
		return ""
	}
	flags := "00"
	if len(parts) >= 3 && strings.TrimSpace(parts[2]) == "1" {
		flags = "01"
	}
	return "00-" + traceID + "-" + spanID + "-" + flags
}

func isLowerHex(value string, length int) bool {
	if len(value) != length {
		return false
	}
	for _, runeValue := range value {
		if (runeValue < '0' || runeValue > '9') && (runeValue < 'a' || runeValue > 'f') {
			return false
		}
	}
	return true
}
