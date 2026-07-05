package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIChatCompletionsWebSearchTransportClientUsesChatPayload(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("path = %q, want /chat/completions", request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer test-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		writeProviderTestJSON(response, map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"annotations": []map[string]any{
							{
								"type": "url_citation",
								"url_citation": map[string]any{
									"title": "中央民族大学上网指南",
									"url":   "https://public.example.edu/network/",
								},
							},
						},
						"content": "校园网密码修改说明。",
					},
				},
			},
		})
	}))
	defer server.Close()

	client := NewOpenAIChatCompletionsWebSearchTransportClient(
		OpenAIChatCompletionsWebSearchTransportClientConfig{
			APIKey:        "test-key",
			BaseURL:       server.URL,
			HTTPClient:    server.Client(),
			MaxResults:    5,
			ModelName:     "gpt-5-search-api-2025-10-14",
			ModelProvider: "linux_do",
		},
	)
	result := client.Execute(context.Background(), OpenAIChatCompletionsWebSearchRequest{
		DomainFilter:       []string{"public.example.edu"},
		ProviderRequestRef: "provider://public-web-search",
		Query:              "校园网密码怎么改",
	})
	if result.Err != nil {
		t.Fatalf("execute chat completions web search: %v", result.Err)
	}
	if body["model"] != "gpt-5-search-api-2025-10-14" || body["max_tokens"] != float64(1024) {
		t.Fatalf("request body = %#v", body)
	}
	options := body["web_search_options"].(map[string]any)
	if options["search_context_size"] != "low" {
		t.Fatalf("web_search_options = %#v", options)
	}
	messages := body["messages"].([]any)
	message := messages[0].(map[string]any)
	if message["role"] != "user" {
		t.Fatalf("message = %#v", message)
	}
	if len(result.Results) != 1 || result.Results[0].URL != "https://public.example.edu/network/" {
		t.Fatalf("results = %#v", result.Results)
	}
	if result.Results[0].Snippet != "校园网密码修改说明。" {
		t.Fatalf("snippet = %q", result.Results[0].Snippet)
	}
	if result.Summary.ModelProvider != "linux_do" || result.Summary.ModelName != "gpt-5-search-api-2025-10-14" {
		t.Fatalf("summary model = %s/%s", result.Summary.ModelProvider, result.Summary.ModelName)
	}
}

func TestOpenAIChatCompletionsWebSearchTransportClientRejectsMissingCitations(t *testing.T) {
	results, err := parseOpenAIChatCompletionsWebSearchPayload([]byte(`{
		"choices":[{
			"message":{
				"content":"没有引用。",
				"annotations":[]
			}
		}]
	}`))
	if err == nil {
		t.Fatalf("parse payload returned nil error and results %#v", results)
	}
}
