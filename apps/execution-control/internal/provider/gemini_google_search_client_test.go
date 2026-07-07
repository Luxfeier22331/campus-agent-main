package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGeminiGoogleSearchTransportClientUsesInteractionsPayload(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/interactions" {
			t.Fatalf("path = %q, want /interactions", request.URL.Path)
		}
		if request.Header.Get("x-goog-api-key") != "test-key" {
			t.Fatalf("x-goog-api-key header = %q", request.Header.Get("x-goog-api-key"))
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		writeProviderTestJSON(response, map[string]any{
			"steps": []map[string]any{
				{
					"type": "model_output",
					"content": []map[string]any{
						{
							"type": "text",
							"text": "校园网密码修改说明。",
							"annotations": []map[string]any{
								{
									"type":  "url_citation",
									"title": "中央民族大学上网指南",
									"url":   "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
								},
							},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	client := NewGeminiGoogleSearchTransportClient(GeminiGoogleSearchTransportClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		HTTPClient:    server.Client(),
		MaxResults:    5,
		ModelName:     "gemini-2.5-flash",
		ModelProvider: "gemini",
	})
	result := client.Execute(context.Background(), GeminiGoogleSearchRequest{
		DomainFilter:       []string{"muc.edu.cn"},
		ProviderRequestRef: "provider://public-web-search",
		Query:              "校园网密码怎么改",
	})
	if result.Err != nil {
		t.Fatalf("execute gemini google search: %v", result.Err)
	}
	if body["model"] != "gemini-2.5-flash" {
		t.Fatalf("body model = %#v", body["model"])
	}
	tools := body["tools"].([]any)
	tool := tools[0].(map[string]any)
	if tool["type"] != "google_search" {
		t.Fatalf("tool = %#v", tool)
	}
	text := body["input"].(string)
	if !strings.Contains(text, "muc.edu.cn") {
		t.Fatalf("prompt text = %q", text)
	}
	if len(result.Results) != 1 || result.Results[0].Snippet != "校园网密码修改说明。" {
		t.Fatalf("results = %#v", result.Results)
	}
	if result.Summary.ModelProvider != "gemini" || result.Summary.ModelName != "gemini-2.5-flash" {
		t.Fatalf("summary model = %s/%s", result.Summary.ModelProvider, result.Summary.ModelName)
	}
}

func TestGeminiGoogleSearchTransportClientRequiresCitationAnnotations(t *testing.T) {
	_, err := parseGeminiGoogleSearchPayload([]byte(`{
		"steps":[{"type":"model_output","content":[{"type":"text","text":"x"}]}]
	}`))
	if err == nil {
		t.Fatal("payload without citation annotations must fail")
	}
}
