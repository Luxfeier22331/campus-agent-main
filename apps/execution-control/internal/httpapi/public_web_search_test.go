package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPublicWebSearchReturnsSanitizedAllowedSources(t *testing.T) {
	var providerRequest map[string]any
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/search" {
			t.Fatalf("provider path = %s, want /search", request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer search-key" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		if err := json.NewDecoder(request.Body).Decode(&providerRequest); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if _, ok := providerRequest["temperature"]; ok {
			t.Fatal("provider request must not include temperature")
		}
		if _, ok := providerRequest["messages"]; ok {
			t.Fatal("provider request must not include chat messages")
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{
				{
					"title":   "中央民族大学上网指南",
					"url":     "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/?utm_source=test#top",
					"snippet": "校园网用户名是学号，初始密码与信息门户密码一致；修改信息门户密码后，上网密码同步生效。",
				},
			},
		})
	}))
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "search-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "sonar",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "perplexity",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "perplexity_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"payload":{"query_text":"校园网密码怎么改","max_results":5}}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["result_kind"] != "public_web_evidence" {
		t.Fatalf("result_kind = %v", body["result_kind"])
	}
	if body["provider"] != "perplexity" || body["model"] != "sonar" {
		t.Fatalf("provider/model = %v/%v", body["provider"], body["model"])
	}
	sources, ok := body["sources"].([]any)
	if !ok || len(sources) != 1 {
		t.Fatalf("sources = %#v, want one sanitized source", body["sources"])
	}
	source := expectRecord(t, sources[0], "sources[0]")
	if source["source_kind"] != "public_web" || source["target_kind"] != "public_web_url" {
		t.Fatalf("source kind/target = %#v", source)
	}
	if source["url"] != "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/" {
		t.Fatalf("url = %v", source["url"])
	}
	if !strings.Contains(source["snippet"].(string), "校园网用户名是学号") {
		t.Fatalf("snippet = %v", source["snippet"])
	}
	if !strings.HasPrefix(source["content_hash"].(string), "sha256:") {
		t.Fatalf("content_hash = %v", source["content_hash"])
	}
}

func TestPublicWebSearchKeepsCompatibleProviderIdentity(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/search" {
			t.Fatalf("provider path = %s, want /search", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{
				{
					"title":   "中央民族大学上网指南",
					"url":     "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
					"snippet": "校园网用户名是学号。",
				},
			},
		})
	}))
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "compatible-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "sonar-compatible",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "perplexity_compatible",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "perplexity_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["provider"] != "perplexity_compatible" || body["model"] != "sonar-compatible" {
		t.Fatalf("provider/model = %v/%v", body["provider"], body["model"])
	}
	if body["result_kind"] != "public_web_evidence" {
		t.Fatalf("result_kind = %v", body["result_kind"])
	}
}

func TestPublicWebSearchReturnsOpenAIResponsesWebSearchSources(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/responses" {
			t.Fatalf("provider path = %s, want /responses", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
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
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "openai-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "gpt-5-search-api",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "openai",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "openai_responses_web_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["result_kind"] != "public_web_evidence" {
		t.Fatalf("result_kind = %v", body["result_kind"])
	}
	if body["provider"] != "openai" || body["model"] != "gpt-5-search-api" {
		t.Fatalf("provider/model = %v/%v", body["provider"], body["model"])
	}
	sources := body["sources"].([]any)
	source := expectRecord(t, sources[0], "sources[0]")
	if source["url"] != "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/" {
		t.Fatalf("source url = %v", source["url"])
	}
}

func TestPublicWebSearchReturnsGeminiGoogleSearchSources(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/interactions" {
			t.Fatalf("provider path = %s, want /interactions", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
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
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "gemini-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "gemini-2.5-flash",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "gemini",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "gemini_google_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["result_kind"] != "public_web_evidence" {
		t.Fatalf("result_kind = %v", body["result_kind"])
	}
	if body["provider"] != "gemini" || body["model"] != "gemini-2.5-flash" {
		t.Fatalf("provider/model = %v/%v", body["provider"], body["model"])
	}
	sources := body["sources"].([]any)
	source := expectRecord(t, sources[0], "sources[0]")
	if source["snippet"] != "校园网密码修改说明。" {
		t.Fatalf("source snippet = %v", source["snippet"])
	}
}

func TestPublicWebSearchReturnsLinuxDoChatCompletionsWebSearchSources(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/chat/completions" {
			t.Fatalf("provider path = %s, want /chat/completions", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"annotations": []map[string]any{
							{
								"type": "url_citation",
								"url_citation": map[string]any{
									"title": "中央民族大学上网指南",
									"url":   "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/?utm_source=openai",
								},
							},
						},
						"content": "校园网密码修改说明。",
					},
				},
			},
		})
	}))
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "linux-do-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "gpt-5-search-api-2025-10-14",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "linux_do",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "openai_chat_completions_web_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["result_kind"] != "public_web_evidence" {
		t.Fatalf("result_kind = %v", body["result_kind"])
	}
	if body["provider"] != "linux_do" || body["model"] != "gpt-5-search-api-2025-10-14" {
		t.Fatalf("provider/model = %v/%v", body["provider"], body["model"])
	}
	sources := body["sources"].([]any)
	source := expectRecord(t, sources[0], "sources[0]")
	if source["url"] != "https://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/" {
		t.Fatalf("source url = %v", source["url"])
	}
	if source["snippet"] != "校园网密码修改说明。" {
		t.Fatalf("source snippet = %v", source["snippet"])
	}
}

func TestPublicWebSearchFailsClosedWhenProviderConfigMissing(t *testing.T) {
	server := newToolReadModelAuthServerForTest()

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	body := decodeBody(t, response)
	if body["fail_close_reason"] != "public_web_search_provider_not_configured" {
		t.Fatalf("fail_close_reason = %v", body["fail_close_reason"])
	}
}

func TestPublicWebSearchFailsClosedWhenProviderConfigUsesRetiredPromptShape(t *testing.T) {
	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "search-key",
			BaseURL:   "https://provider.example/v1",
			Kind:      "prompt",
			Model:     "gpt-search",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "openai-compatible",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "chat_completions",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["fail_close_reason"] != "public_web_search_provider_not_configured" {
		t.Fatalf("fail_close_reason = %v", body["fail_close_reason"])
	}
}

func TestPublicWebSearchFailsClosedWhenProviderOutputHasNoAllowedSource(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{},
		})
	}))
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "search-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "sonar",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "perplexity",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "perplexity_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["fail_close_reason"] != "public_web_search_provider_failed" {
		t.Fatalf("fail_close_reason = %v", body["fail_close_reason"])
	}
}

func TestPublicWebSearchFailsClosedWhenProviderSourceIsDisallowed(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusOK, map[string]any{
			"results": []map[string]any{
				{
					"title":   "外部来源",
					"url":     "https://example.com/muc",
					"snippet": "外部来源不应进入结果。",
				},
			},
		})
	}))
	defer providerServer.Close()

	server := newToolReadModelAuthServerForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		"public_web_search": {
			APIKey:    "search-key",
			BaseURL:   providerServer.URL,
			Kind:      "search",
			Model:     "sonar",
			ProfileID: "provider_profile_public_web_search",
			Provider:  "perplexity",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "perplexity_search",
		},
	}

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/public-web/search",
		strings.NewReader(`{"query_text":"校园网密码怎么改","max_results":5}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	body := decodeBody(t, response)
	if body["fail_close_reason"] != "public_web_search_invalid_provider_output" {
		t.Fatalf("fail_close_reason = %v", body["fail_close_reason"])
	}
}

func TestPublicWebSearchRejectsNonHTTPSAndPrivatePortalSources(t *testing.T) {
	for _, sourceURL := range []string{
		"http://yx.muc.edu.cn/shuzixiaoyuan/shangwangzhinan/",
		"https://my.muc.edu.cn/",
	} {
		t.Run(sourceURL, func(t *testing.T) {
			_, err := normalizePublicWebURL(sourceURL)
			if err == nil {
				t.Fatalf("normalizePublicWebURL(%q) expected rejection", sourceURL)
			}
		})
	}
}
