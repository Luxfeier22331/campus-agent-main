package provider

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPerplexitySearchTransportClientUsesSearchPayload(t *testing.T) {
	var requestPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/search" {
			t.Fatalf("path = %s, want /search", request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer pplx-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&requestPayload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		writeJSONForProviderTest(response, map[string]any{
			"results": []map[string]any{{
				"date":         "2026-01-01",
				"last_updated": "2026-01-02",
				"snippet":      "中央民族大学上网指南。",
				"title":        "上网指南",
				"url":          "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
			}},
		})
	}))
	defer server.Close()

	client := NewPerplexitySearchTransportClient(PerplexitySearchTransportClientConfig{
		APIKey:        "pplx-key",
		BaseURL:       server.URL,
		MaxResults:    5,
		ModelName:     "sonar",
		ModelProvider: "perplexity",
	})
	result := client.Execute(t.Context(), PerplexitySearchRequest{
		DomainFilter:       []string{"muc.edu.cn"},
		ProviderRequestRef: "provider://public-web-search",
		Query:              "校园网密码怎么改",
	})
	if result.Err != nil {
		t.Fatalf("Execute() error = %v", result.Err)
	}
	if requestPayload["query"] != "校园网密码怎么改" ||
		requestPayload["max_results"] != float64(5) {
		t.Fatalf("request payload = %#v", requestPayload)
	}
	if _, ok := requestPayload["messages"]; ok {
		t.Fatal("search payload must not include chat messages")
	}
	domainFilter, ok := requestPayload["search_domain_filter"].([]any)
	if !ok || len(domainFilter) != 1 || domainFilter[0] != "muc.edu.cn" {
		t.Fatalf("domain filter = %#v", requestPayload["search_domain_filter"])
	}
	if len(result.Results) != 1 || !strings.Contains(result.Results[0].Snippet, "上网指南") {
		t.Fatalf("results = %#v", result.Results)
	}
	if result.Summary.ModelProvider != "perplexity" ||
		result.Summary.ProviderRequestRef != "provider://public-web-search" {
		t.Fatalf("summary = %#v", result.Summary)
	}
}

func TestPerplexitySearchTransportClientReportsProviderHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Error(response, "bad", http.StatusBadGateway)
	}))
	defer server.Close()

	client := NewPerplexitySearchTransportClient(PerplexitySearchTransportClientConfig{
		APIKey:        "pplx-key",
		BaseURL:       server.URL,
		ModelName:     "sonar",
		ModelProvider: "perplexity",
	})
	result := client.Execute(t.Context(), PerplexitySearchRequest{Query: "hello"})
	if result.Err == nil {
		t.Fatal("Execute() expected provider status error")
	}
	if result.Status != http.StatusBadGateway ||
		result.Summary.DiagnosticStatus != DiagnosticProviderHTTPError {
		t.Fatalf("status/summary = %d/%#v", result.Status, result.Summary)
	}
}
