package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestResponsesClientCancelClosesForegroundRequest(t *testing.T) {
	requestStarted := make(chan struct{})
	requestClosed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("path = %q, want /responses", request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		response.WriteHeader(http.StatusOK)
		if flusher, ok := response.(http.Flusher); ok {
			flusher.Flush()
		}
		close(requestStarted)
		<-request.Context().Done()
		close(requestClosed)
	}))
	defer server.Close()
	catalog, err := LoadPricingCatalog(writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	client := NewResponsesClient(ResponsesClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		ModelName:     "gpt-5-mini",
		ModelProvider: "openai",
		Pricing:       catalog,
		HTTPClient:    server.Client(),
	})
	ctx, cancel := context.WithCancel(context.Background())
	resultCh := make(chan ResponsesClientResult, 1)
	go func() {
		resultCh <- client.Execute(ctx, ResponsesRequest{
			Input:              []map[string]any{{"role": "user", "content": "hello"}},
			ProviderRequestRef: "provider://requests/run-1/synthesis",
		})
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("provider request did not start")
	}
	cancel()
	select {
	case <-requestClosed:
	case <-time.After(time.Second):
		t.Fatal("provider request context was not closed after cancellation")
	}
	select {
	case result := <-resultCh:
		if result.Err == nil {
			t.Fatal("canceled provider request must return an error")
		}
		if result.Summary.CancelOutcome != CancelOutcomeProviderConnectionAborted {
			t.Fatalf(
				"cancel outcome = %q, want provider_connection_aborted",
				result.Summary.CancelOutcome,
			)
		}
	case <-time.After(time.Second):
		t.Fatal("provider client did not return after cancellation")
	}
}

func TestResponsesClientDeadlineRecordsProviderTimeout(t *testing.T) {
	requestStarted := make(chan struct{})
	requestClosed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("path = %q, want /responses", request.URL.Path)
		}
		response.Header().Set("content-type", "application/json")
		response.WriteHeader(http.StatusOK)
		if flusher, ok := response.(http.Flusher); ok {
			flusher.Flush()
		}
		close(requestStarted)
		<-request.Context().Done()
		close(requestClosed)
	}))
	defer server.Close()
	catalog, err := LoadPricingCatalog(writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	client := NewResponsesClient(ResponsesClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		ModelName:     "gpt-5-mini",
		ModelProvider: "openai",
		Pricing:       catalog,
		HTTPClient:    server.Client(),
	})
	ctx, expireDeadline := newManualDeadlineContext(context.Background())
	resultCh := make(chan ResponsesClientResult, 1)
	go func() {
		resultCh <- client.Execute(ctx, ResponsesRequest{
			Input:              []map[string]any{{"role": "user", "content": "hello"}},
			ProviderRequestRef: "provider://requests/run-1/synthesis",
		})
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("provider request did not start")
	}
	expireDeadline()
	select {
	case <-requestClosed:
	case <-time.After(time.Second):
		t.Fatal("provider request context was not closed after deadline")
	}
	select {
	case result := <-resultCh:
		if result.Err == nil {
			t.Fatal("timed-out provider request must return an error")
		}
		if result.Summary.CancelOutcome != CancelOutcomeNotRequested {
			t.Fatalf("cancel outcome = %q, want not_requested", result.Summary.CancelOutcome)
		}
		if result.Summary.TimeoutOutcome != TimeoutOutcomeProviderTimeout {
			t.Fatalf("timeout outcome = %q, want provider_timeout", result.Summary.TimeoutOutcome)
		}
	case <-time.After(time.Second):
		t.Fatal("provider client did not return after deadline")
	}
}

type manualDeadlineContext struct {
	context.Context
	done chan struct{}
	once sync.Once
}

func newManualDeadlineContext(parent context.Context) (*manualDeadlineContext, context.CancelFunc) {
	ctx := &manualDeadlineContext{
		Context: parent,
		done:    make(chan struct{}),
	}
	return ctx, func() {
		ctx.once.Do(func() {
			close(ctx.done)
		})
	}
}

func (ctx *manualDeadlineContext) Deadline() (time.Time, bool) {
	return time.Now().Add(time.Hour), true
}

func (ctx *manualDeadlineContext) Done() <-chan struct{} {
	return ctx.done
}

func (ctx *manualDeadlineContext) Err() error {
	select {
	case <-ctx.done:
		return context.DeadlineExceeded
	default:
		return nil
	}
}

func TestResponsesClientBuildsProviderExecutionSummary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("authorization") != "Bearer test-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["model"] != "gpt-5-mini" {
			t.Fatalf("model = %v", body["model"])
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_123",
			"model":"gpt-5-mini",
			"usage":{
				"input_tokens":1000,
				"output_tokens":500,
				"input_tokens_details":{"cached_tokens":200}
			}
		}`))
	}))
	defer server.Close()
	catalog, err := LoadPricingCatalog(writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	client := NewResponsesClient(ResponsesClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		ModelName:     "gpt-5-mini",
		ModelProvider: "openai",
		Pricing:       catalog,
		HTTPClient:    server.Client(),
	})

	result := client.Execute(context.Background(), ResponsesRequest{
		Input:              []map[string]any{{"role": "user", "content": "hello"}},
		ProviderRequestRef: "provider://requests/run-1/synthesis",
	})
	if result.Err != nil {
		t.Fatalf("execute responses request: %v", result.Err)
	}
	if result.Summary.ProviderResponseID != "resp_123" {
		t.Fatalf("provider response id = %q", result.Summary.ProviderResponseID)
	}
	if result.Summary.EstimatedCostMicroUSD != 1205 {
		t.Fatalf("estimated cost = %d, want 1205", result.Summary.EstimatedCostMicroUSD)
	}
	if result.Summary.CancelOutcome != CancelOutcomeNotRequested {
		t.Fatalf("cancel outcome = %q", result.Summary.CancelOutcome)
	}
}

func TestResponsesClientBuildsSummaryForProviderHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("path = %q, want /responses", request.URL.Path)
		}
		response.WriteHeader(http.StatusBadGateway)
		_, _ = response.Write([]byte(`{"error":{"message":"upstream unavailable"}}`))
	}))
	defer server.Close()
	client := NewResponsesClient(ResponsesClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		HTTPClient:    server.Client(),
		ModelName:     "gpt-5.5",
		ModelProvider: "openai",
	})

	result := client.Execute(context.Background(), ResponsesRequest{
		Input:              []map[string]any{{"role": "user", "content": "hello"}},
		ProviderRequestRef: "provider://requests/run-1/synthesis",
	})
	if result.Err == nil {
		t.Fatal("provider HTTP error must return an error")
	}
	if result.Status != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", result.Status)
	}
	if result.Summary.DiagnosticStatus != DiagnosticProviderHTTPError {
		t.Fatalf(
			"diagnostic status = %q, want provider_http_error",
			result.Summary.DiagnosticStatus,
		)
	}
	if result.Summary.ModelProvider != "openai" || result.Summary.ModelName != "gpt-5.5" {
		t.Fatalf("summary model = %s/%s", result.Summary.ModelProvider, result.Summary.ModelName)
	}
	if result.Summary.ProviderRequestRef != "provider://requests/run-1/synthesis" {
		t.Fatalf("provider request ref = %q", result.Summary.ProviderRequestRef)
	}
}

func TestResponsesClientAppliesGenerationControls(t *testing.T) {
	store := false
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["max_output_tokens"] != float64(900) {
			t.Fatalf("max_output_tokens = %#v", body["max_output_tokens"])
		}
		if body["store"] != false {
			t.Fatalf("store = %#v", body["store"])
		}
		reasoning, ok := body["reasoning"].(map[string]any)
		if !ok || reasoning["effort"] != "low" {
			t.Fatalf("reasoning = %#v", body["reasoning"])
		}
		text, ok := body["text"].(map[string]any)
		if !ok {
			t.Fatalf("text = %#v", body["text"])
		}
		if text["verbosity"] != "low" {
			t.Fatalf("text verbosity = %#v", text["verbosity"])
		}
		format, ok := text["format"].(map[string]any)
		if !ok || format["type"] != "json_schema" {
			t.Fatalf("text format = %#v", text["format"])
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{
			"id":"resp_123",
			"model":"gpt-5-mini",
			"status":"completed",
			"usage":{
				"input_tokens":1,
				"output_tokens":1,
				"input_tokens_details":{"cached_tokens":0}
			}
		}`))
	}))
	defer server.Close()
	catalog, err := LoadPricingCatalog(writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`))
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	client := NewResponsesClient(ResponsesClientConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
		GenerationControls: ResponsesGenerationControls{
			MaxOutputTokens: 900,
			ReasoningEffort: "low",
			Store:           &store,
			TextVerbosity:   "low",
		},
		HTTPClient:    server.Client(),
		ModelName:     "gpt-5-mini",
		ModelProvider: "openai",
		Pricing:       catalog,
	})

	result := client.Execute(context.Background(), ResponsesRequest{
		Input: []map[string]any{{"role": "user", "content": "hello"}},
		Text:  map[string]any{"format": map[string]any{"type": "json_schema"}},
	})
	if result.Err != nil {
		t.Fatalf("execute responses request: %v", result.Err)
	}
}
