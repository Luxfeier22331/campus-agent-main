package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/baggage"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestHindsightHTTPClientHealthRequiresNativeLLMTracing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/version" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"api_version":"0.8.4",
			"features":{
				"observations":true,
				"mcp":false,
				"worker":true,
				"bank_config_api":true,
				"bank_llm_health":false,
				"file_upload_api":true,
				"document_export_api":true,
				"document_import_api":true,
				"audit_log":false,
				"llm_trace":true,
				"store_document_text":true
			}
		}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	if err := client.HealthCheck(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestHindsightHTTPClientHealthRejectsMissingNativeLLMTracing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/version" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"api_version":"0.8.4",
			"features":{
				"observations":true,
				"mcp":false,
				"worker":true,
				"bank_config_api":true,
				"bank_llm_health":false,
				"file_upload_api":true,
				"document_export_api":true,
				"document_import_api":true,
				"audit_log":false,
				"llm_trace":false,
				"store_document_text":true
			}
		}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	err := client.HealthCheck(context.Background())
	if err == nil || !strings.Contains(err.Error(), "llm_trace=false") {
		t.Fatalf("error = %v, want missing native tracing diagnostic", err)
	}
}

func TestHindsightHTTPClientSendsSynchronousReplaceRetain(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/default/banks/bank-01/memories" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var payload struct {
			Async *bool                 `json:"async"`
			Items []hindsightMemoryItem `json:"items"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload.Async == nil || *payload.Async || len(payload.Items) != 1 || payload.Items[0].UpdateMode != "replace" {
			t.Fatalf("payload = %#v", payload)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"success":true,"bank_id":"bank-01","items_count":1,"async":false}`))
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	result, err := client.RetainMemories(context.Background(), "bank-01", hindsightRetainRequest{
		Async: boolPtr(false),
		Items: []hindsightMemoryItem{{
			Content: "user message", DocumentID: "conversation:abc:message:def", UpdateMode: "replace",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Async || result.ItemsCount != 1 || result.BankID != "bank-01" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHindsightHTTPClientTreatsMissingSourceAndBankAsDeleted(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method + " " + request.URL.Path {
		case "DELETE /v1/default/banks/bank-01/documents/conversation:abc:message:def":
			response.WriteHeader(http.StatusNotFound)
			_, _ = response.Write([]byte(`{"detail":"not found"}`))
		case "DELETE /v1/default/banks/bank-01":
			response.WriteHeader(http.StatusNotFound)
			_, _ = response.Write([]byte(`{"detail":"not found"}`))
		default:
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
	}))
	defer server.Close()

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	if err := client.DeleteDocument(context.Background(), "bank-01", "conversation:abc:message:def"); err != nil {
		t.Fatalf("delete missing document: %v", err)
	}
	if err := client.DeleteBank(context.Background(), "bank-01"); err != nil {
		t.Fatalf("delete missing bank: %v", err)
	}
}

func TestHindsightHTTPClientPropagatesTraceContextAndPreservesAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer hindsight-secret" {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		if !strings.HasPrefix(request.Header.Get("traceparent"), "00-4bf92f3577b34da6a3ce929d0e0e4736-") ||
			!strings.HasSuffix(request.Header.Get("traceparent"), "-01") {
			t.Fatalf("traceparent = %q", request.Header.Get("traceparent"))
		}
		if request.Header.Get("baggage") != "tenant.id=campus" {
			t.Fatalf("baggage = %q", request.Header.Get("baggage"))
		}
		response.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	previousProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(previousProvider)
	defer func() { _ = provider.Shutdown(context.Background()) }()
	spanContext := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{0x4b, 0xf9, 0x2f, 0x35, 0x77, 0xb3, 0x4d, 0xa6, 0xa3, 0xce, 0x92, 0x9d, 0x0e, 0x0e, 0x47, 0x36},
		SpanID:     trace.SpanID{0x00, 0xf0, 0x67, 0xaa, 0x0b, 0xa9, 0x02, 0xb7},
		TraceFlags: trace.FlagsSampled,
		Remote:     false,
	})
	member, err := baggage.NewMember("tenant.id", "campus")
	if err != nil {
		t.Fatal(err)
	}
	traceBaggage, err := baggage.New(member)
	if err != nil {
		t.Fatal(err)
	}
	ctx := trace.ContextWithSpanContext(context.Background(), spanContext)
	ctx = baggage.ContextWithBaggage(ctx, traceBaggage)

	client := newHindsightHTTPClient(hindsightClientOptions{apiSecret: "hindsight-secret", baseURL: server.URL})
	if _, err := client.BankExists(ctx, "bank-01"); err != nil {
		t.Fatal(err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 || spans[0].Name() != "memory.call" || spans[0].SpanKind() != trace.SpanKindClient {
		t.Fatalf("memory spans = %#v", spans)
	}
	attributes := map[attribute.Key]string{}
	for _, item := range spans[0].Attributes() {
		attributes[item.Key] = item.Value.AsString()
	}
	if attributes["memory.provider"] != "hindsight" ||
		attributes["http.request.method"] != http.MethodGet ||
		attributes["langfuse.user.id"] != "bank-01" {
		t.Fatalf("memory span attributes = %#v", attributes)
	}
}
