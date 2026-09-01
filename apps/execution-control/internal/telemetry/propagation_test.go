package telemetry

import (
	"context"
	"net/http"
	"reflect"
	"testing"
)

func TestExtractIncomingContextAcceptsTraceParent(t *testing.T) {
	headers := http.Header{}
	const traceParent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	headers.Set("traceparent", traceParent)

	traceHeaders := InjectExecutionTraceHeaders(
		ExtractIncomingContext(context.Background(), headers),
		"req-001",
	)

	if traceHeaders["traceparent"] != traceParent {
		t.Fatalf("traceparent = %q", traceHeaders["traceparent"])
	}
	if traceHeaders["x-request-id"] != "req-001" {
		t.Fatalf("x-request-id = %q", traceHeaders["x-request-id"])
	}
}

func TestExtractIncomingContextIgnoresBaggage(t *testing.T) {
	ambientContext := ExtractTraceParent(
		context.Background(),
		"00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
	)
	for name, testCase := range map[string]struct {
		headerName  string
		headerValue string
	}{
		"baggage": {
			headerName:  "baggage",
			headerValue: "release=2026.07.11",
		},
	} {
		t.Run(name, func(t *testing.T) {
			headers := http.Header{}
			headers.Set(testCase.headerName, testCase.headerValue)

			traceHeaders := InjectExecutionTraceHeaders(
				ExtractIncomingContext(ambientContext, headers),
				"req-001",
			)
			want := map[string]string{
				"x-request-id": "req-001",
			}
			if !reflect.DeepEqual(traceHeaders, want) {
				t.Fatalf("trace headers = %#v, want %#v", traceHeaders, want)
			}
		})
	}
}

func TestExtractTraceParentRejectsInvalidAndClearsExistingContext(t *testing.T) {
	ambientContext := ExtractTraceParent(
		context.Background(),
		"00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
	)
	for name, traceParent := range map[string]string{
		"empty":   "",
		"invalid": "not-a-traceparent",
	} {
		t.Run(name, func(t *testing.T) {
			traceHeaders := InjectExecutionTraceHeaders(
				ExtractTraceParent(ambientContext, traceParent),
				"req-001",
			)
			want := map[string]string{
				"x-request-id": "req-001",
			}
			if !reflect.DeepEqual(traceHeaders, want) {
				t.Fatalf("trace headers = %#v, want %#v", traceHeaders, want)
			}
		})
	}
}
