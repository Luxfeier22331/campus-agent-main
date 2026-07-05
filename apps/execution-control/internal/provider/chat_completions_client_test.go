package provider

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatCompletionsClientUsesNarrowOpenAICompatiblePayload(t *testing.T) {
	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer test-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&requestPayload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		writeJSONForProviderTest(response, map[string]any{
			"id": "chatcmpl-1",
			"choices": []map[string]any{{
				"message": map[string]any{"content": `{"sources":[]}`},
			}},
			"usage": map[string]any{
				"prompt_tokens":     11,
				"completion_tokens": 7,
				"prompt_tokens_details": map[string]any{
					"cached_tokens": 3,
				},
			},
		})
	}))
	defer server.Close()

	client := NewChatCompletionsClient(ChatCompletionsClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL + "/v1",
		MaxTokens:     900,
		ModelName:     "gpt-5-search-api-2025-10-14",
		ModelProvider: "openai-compatible",
	})
	result := client.Execute(t.Context(), ChatCompletionsRequest{
		Messages: []ChatCompletionMessage{{Role: "user", Content: "hello"}},
	})
	if result.Err != nil {
		t.Fatalf("Execute() error = %v", result.Err)
	}
	if requestPayload["model"] != "gpt-5-search-api-2025-10-14" || requestPayload["stream"] != false {
		t.Fatalf("request payload = %#v", requestPayload)
	}
	if _, ok := requestPayload["temperature"]; ok {
		t.Fatal("request payload must not include temperature")
	}
	if result.Text != `{"sources":[]}` || result.Summary.ProviderResponseID != "chatcmpl-1" {
		t.Fatalf("result text/id = %q/%q", result.Text, result.Summary.ProviderResponseID)
	}
	if result.Summary.InputTokens != 11 || result.Summary.OutputTokens != 7 ||
		result.Summary.CachedInputTokens != 3 {
		t.Fatalf("usage summary = %#v", result.Summary)
	}
}

func writeJSONForProviderTest(response http.ResponseWriter, value any) {
	response.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(response).Encode(value); err != nil {
		panic(err)
	}
}

func TestChatCompletionsClientReportsProviderHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Error(response, "bad", http.StatusBadGateway)
	}))
	defer server.Close()

	client := NewChatCompletionsClient(ChatCompletionsClientConfig{
		APIKey:        "test-key",
		BaseURL:       strings.TrimRight(server.URL, "/") + "/v1",
		ModelName:     "search-model",
		ModelProvider: "openai-compatible",
	})
	result := client.Execute(t.Context(), ChatCompletionsRequest{})
	if result.Err == nil {
		t.Fatal("Execute() expected provider status error")
	}
	if result.Status != http.StatusBadGateway ||
		result.Summary.DiagnosticStatus != DiagnosticProviderHTTPError {
		t.Fatalf("status/summary = %d/%#v", result.Status, result.Summary)
	}
}
