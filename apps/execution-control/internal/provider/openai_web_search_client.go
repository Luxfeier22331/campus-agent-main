package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type OpenAIWebSearchTransportClientConfig struct {
	APIKey        string
	BaseURL       string
	HTTPClient    *http.Client
	MaxResults    int
	ModelName     string
	ModelProvider string
}

type OpenAIWebSearchTransportClient struct {
	apiKey        string
	baseURL       string
	httpClient    *http.Client
	maxResults    int
	modelName     string
	modelProvider string
}

type OpenAIWebSearchRequest struct {
	DomainFilter       []string
	ProviderRequestRef string
	Query              string
}

type OpenAIWebSearchResult struct {
	Snippet string
	Title   string
	URL     string
}

type OpenAIWebSearchTransportClientResult struct {
	Body    []byte
	Err     error
	Results []OpenAIWebSearchResult
	Status  int
	Summary ExecutionSummary
}

func NewOpenAIWebSearchTransportClient(
	config OpenAIWebSearchTransportClientConfig,
) *OpenAIWebSearchTransportClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &OpenAIWebSearchTransportClient{
		apiKey:        strings.TrimSpace(config.APIKey),
		baseURL:       strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		httpClient:    httpClient,
		maxResults:    config.MaxResults,
		modelName:     strings.TrimSpace(config.ModelName),
		modelProvider: strings.TrimSpace(config.ModelProvider),
	}
}

func (c *OpenAIWebSearchTransportClient) Execute(
	ctx context.Context,
	request OpenAIWebSearchRequest,
) OpenAIWebSearchTransportClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return OpenAIWebSearchTransportClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/responses",
		bytes.NewReader(body),
	)
	if err != nil {
		return OpenAIWebSearchTransportClientResult{Err: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return OpenAIWebSearchTransportClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return OpenAIWebSearchTransportClientResult{Err: readErr}
	}
	completedAt := time.Now().UTC()
	summary := ExecutionSummary{
		CancelOutcome:      CancelOutcomeNotRequested,
		CompletedAt:        completedAt.Format(time.RFC3339Nano),
		DiagnosticStatus:   DiagnosticComplete,
		LatencyMS:          completedAt.Sub(startedAt).Milliseconds(),
		ModelName:          c.modelName,
		ModelProvider:      c.modelProvider,
		ProviderRequestRef: strings.TrimSpace(request.ProviderRequestRef),
		SchemaVersion:      "provider_execution_summary_v1",
		StartedAt:          startedAt.Format(time.RFC3339Nano),
		TimeoutOutcome:     TimeoutOutcomeNotTimedOut,
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		summary.DiagnosticStatus = DiagnosticProviderHTTPError
		return OpenAIWebSearchTransportClientResult{
			Body:    responseBody,
			Err:     fmt.Errorf("provider openai_responses_web_search transport status %d", response.StatusCode),
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	results, err := parseOpenAIWebSearchPayload(responseBody)
	if err != nil {
		summary.DiagnosticStatus = DiagnosticProviderUsageMissing
		return OpenAIWebSearchTransportClientResult{
			Body:    responseBody,
			Err:     err,
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	return OpenAIWebSearchTransportClientResult{
		Body:    responseBody,
		Results: results,
		Status:  response.StatusCode,
		Summary: summary,
	}
}

func (c *OpenAIWebSearchTransportClient) requestPayload(
	request OpenAIWebSearchRequest,
) map[string]any {
	maxResults := c.maxResults
	if maxResults <= 0 {
		maxResults = 5
	}
	return map[string]any{
		"include": []string{"web_search_call.action.sources"},
		"input":   strings.TrimSpace(request.Query),
		"model":   c.modelName,
		"tools": []map[string]any{
			{
				"filters": map[string]any{
					"allowed_domains": request.DomainFilter,
				},
				"search_context_size": "low",
				"type":                "web_search",
			},
		},
		"tool_choice": "required",
		"text": map[string]any{
			"format": map[string]any{"type": "text"},
		},
		"truncation": "auto",
		"metadata": map[string]any{
			"max_public_web_sources": maxResults,
		},
	}
}

func parseOpenAIWebSearchPayload(payload []byte) ([]OpenAIWebSearchResult, error) {
	var decoded struct {
		Output []struct {
			Type   string `json:"type"`
			Action struct {
				Sources []struct {
					Title string `json:"title"`
					URL   string `json:"url"`
				} `json:"sources"`
			} `json:"action"`
			Content []struct {
				Text        string `json:"text"`
				Annotations []struct {
					Title string `json:"title"`
					Type  string `json:"type"`
					URL   string `json:"url"`
				} `json:"annotations"`
			} `json:"content"`
		} `json:"output"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("provider openai web search response must be a JSON object: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("provider openai web search response must not contain trailing data")
	}
	results := []OpenAIWebSearchResult{}
	for _, item := range decoded.Output {
		for _, source := range item.Action.Sources {
			results = appendOpenAIWebSearchResult(results, source.Title, source.URL, "")
		}
		for _, content := range item.Content {
			for _, annotation := range content.Annotations {
				if annotation.Type == "url_citation" {
					results = appendOpenAIWebSearchResult(results, annotation.Title, annotation.URL, content.Text)
				}
			}
		}
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("provider openai web search response contains no sources")
	}
	return results, nil
}

func appendOpenAIWebSearchResult(
	results []OpenAIWebSearchResult,
	title string,
	url string,
	snippet string,
) []OpenAIWebSearchResult {
	title = strings.TrimSpace(title)
	url = strings.TrimSpace(url)
	snippet = strings.TrimSpace(snippet)
	if title == "" || url == "" {
		return results
	}
	if snippet == "" {
		snippet = title
	}
	return append(results, OpenAIWebSearchResult{
		Snippet: snippet,
		Title:   title,
		URL:     url,
	})
}
