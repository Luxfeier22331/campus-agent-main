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

type OpenAIChatCompletionsWebSearchTransportClientConfig struct {
	APIKey        string
	BaseURL       string
	HTTPClient    *http.Client
	MaxResults    int
	ModelName     string
	ModelProvider string
}

type OpenAIChatCompletionsWebSearchTransportClient struct {
	apiKey        string
	baseURL       string
	httpClient    *http.Client
	maxResults    int
	modelName     string
	modelProvider string
}

type OpenAIChatCompletionsWebSearchRequest struct {
	DomainFilter       []string
	ProviderRequestRef string
	Query              string
}

type OpenAIChatCompletionsWebSearchResult struct {
	Snippet string
	Title   string
	URL     string
}

type OpenAIChatCompletionsWebSearchTransportClientResult struct {
	Body    []byte
	Err     error
	Results []OpenAIChatCompletionsWebSearchResult
	Status  int
	Summary ExecutionSummary
}

func NewOpenAIChatCompletionsWebSearchTransportClient(
	config OpenAIChatCompletionsWebSearchTransportClientConfig,
) *OpenAIChatCompletionsWebSearchTransportClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &OpenAIChatCompletionsWebSearchTransportClient{
		apiKey:        strings.TrimSpace(config.APIKey),
		baseURL:       strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		httpClient:    httpClient,
		maxResults:    config.MaxResults,
		modelName:     strings.TrimSpace(config.ModelName),
		modelProvider: strings.TrimSpace(config.ModelProvider),
	}
}

func (c *OpenAIChatCompletionsWebSearchTransportClient) Execute(
	ctx context.Context,
	request OpenAIChatCompletionsWebSearchRequest,
) OpenAIChatCompletionsWebSearchTransportClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return OpenAIChatCompletionsWebSearchTransportClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/chat/completions",
		bytes.NewReader(body),
	)
	if err != nil {
		return OpenAIChatCompletionsWebSearchTransportClientResult{Err: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return OpenAIChatCompletionsWebSearchTransportClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return OpenAIChatCompletionsWebSearchTransportClientResult{Err: readErr}
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
		return OpenAIChatCompletionsWebSearchTransportClientResult{
			Body:    responseBody,
			Err:     fmt.Errorf("provider openai_chat_completions_web_search transport status %d", response.StatusCode),
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	results, err := parseOpenAIChatCompletionsWebSearchPayload(responseBody)
	if err != nil {
		summary.DiagnosticStatus = DiagnosticProviderUsageMissing
		return OpenAIChatCompletionsWebSearchTransportClientResult{
			Body:    responseBody,
			Err:     err,
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	return OpenAIChatCompletionsWebSearchTransportClientResult{
		Body:    responseBody,
		Results: results,
		Status:  response.StatusCode,
		Summary: summary,
	}
}

func (c *OpenAIChatCompletionsWebSearchTransportClient) requestPayload(
	request OpenAIChatCompletionsWebSearchRequest,
) map[string]any {
	prompt := strings.TrimSpace(request.Query)
	if len(request.DomainFilter) > 0 {
		prompt = prompt + "\nOnly cite public HTTPS sources from these domains: " + strings.Join(request.DomainFilter, ", ")
	}
	return map[string]any{
		"max_tokens": 1024,
		"messages": []map[string]any{
			{
				"content": prompt,
				"role":    "user",
			},
		},
		"model": c.modelName,
		"web_search_options": map[string]any{
			"search_context_size": "low",
		},
	}
}

func parseOpenAIChatCompletionsWebSearchPayload(
	payload []byte,
) ([]OpenAIChatCompletionsWebSearchResult, error) {
	var decoded struct {
		Choices []struct {
			Message struct {
				Annotations []struct {
					Type        string `json:"type"`
					URLCitation struct {
						Title string `json:"title"`
						URL   string `json:"url"`
					} `json:"url_citation"`
				} `json:"annotations"`
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("provider openai chat completions web search response must be a JSON object: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("provider openai chat completions web search response must not contain trailing data")
	}
	results := []OpenAIChatCompletionsWebSearchResult{}
	for _, choice := range decoded.Choices {
		snippet := strings.TrimSpace(choice.Message.Content)
		for _, annotation := range choice.Message.Annotations {
			if annotation.Type != "url_citation" {
				continue
			}
			results = appendOpenAIChatCompletionsWebSearchResult(
				results,
				annotation.URLCitation.Title,
				annotation.URLCitation.URL,
				snippet,
			)
		}
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("provider openai chat completions web search response contains no sources")
	}
	return results, nil
}

func appendOpenAIChatCompletionsWebSearchResult(
	results []OpenAIChatCompletionsWebSearchResult,
	title string,
	url string,
	snippet string,
) []OpenAIChatCompletionsWebSearchResult {
	title = strings.TrimSpace(title)
	url = strings.TrimSpace(url)
	snippet = strings.TrimSpace(snippet)
	if title == "" || url == "" {
		return results
	}
	if snippet == "" {
		snippet = title
	}
	return append(results, OpenAIChatCompletionsWebSearchResult{
		Snippet: snippet,
		Title:   title,
		URL:     url,
	})
}
