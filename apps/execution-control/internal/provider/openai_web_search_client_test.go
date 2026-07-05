package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAIWebSearchTransportClientUsesResponsesWebSearchPayload(t *testing.T) {
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("path = %q, want /responses", request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer test-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		writeProviderTestJSON(response, map[string]any{
			"output": []map[string]any{
				{
					"type": "web_search_call",
					"action": map[string]any{
						"sources": []map[string]any{
							{
								"title": "中央民族大学上网指南",
								"url":   "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
							},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	client := NewOpenAIWebSearchTransportClient(OpenAIWebSearchTransportClientConfig{
		APIKey:        "test-key",
		BaseURL:       server.URL,
		HTTPClient:    server.Client(),
		MaxResults:    5,
		ModelName:     "gpt-5-search-api",
		ModelProvider: "openai",
	})
	result := client.Execute(context.Background(), OpenAIWebSearchRequest{
		DomainFilter:       []string{"muc.edu.cn"},
		ProviderRequestRef: "provider://public-web-search",
		Query:              "校园网密码怎么改",
	})
	if result.Err != nil {
		t.Fatalf("execute openai web search: %v", result.Err)
	}
	if body["model"] != "gpt-5-search-api" || body["tool_choice"] != "required" {
		t.Fatalf("request body = %#v", body)
	}
	tools := body["tools"].([]any)
	tool := tools[0].(map[string]any)
	if tool["type"] != "web_search" {
		t.Fatalf("tool = %#v", tool)
	}
	filters := tool["filters"].(map[string]any)
	allowedDomains := filters["allowed_domains"].([]any)
	if allowedDomains[0] != "muc.edu.cn" {
		t.Fatalf("allowed domains = %#v", allowedDomains)
	}
	if len(result.Results) != 1 || result.Results[0].URL != "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/" {
		t.Fatalf("results = %#v", result.Results)
	}
	if result.Summary.ModelProvider != "openai" || result.Summary.ModelName != "gpt-5-search-api" {
		t.Fatalf("summary model = %s/%s", result.Summary.ModelProvider, result.Summary.ModelName)
	}
}

func TestOpenAIWebSearchTransportClientParsesCitationAnnotations(t *testing.T) {
	results, err := parseOpenAIWebSearchPayload([]byte(`{
		"output":[{
			"type":"message",
			"content":[{
				"text":"校园网密码修改说明。",
				"annotations":[{
					"type":"url_citation",
					"title":"中央民族大学上网指南",
					"url":"https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/"
				}]
			}]
		}]
	}`))
	if err != nil {
		t.Fatalf("parse payload: %v", err)
	}
	if len(results) != 1 || results[0].Snippet != "校园网密码修改说明。" {
		t.Fatalf("results = %#v", results)
	}
}

func writeProviderTestJSON(response http.ResponseWriter, payload any) {
	response.Header().Set("content-type", "application/json")
	if err := json.NewEncoder(response).Encode(payload); err != nil {
		panic(err)
	}
}
