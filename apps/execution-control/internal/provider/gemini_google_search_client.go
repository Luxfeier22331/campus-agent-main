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

type GeminiGoogleSearchTransportClientConfig struct {
	APIKey        string
	BaseURL       string
	HTTPClient    *http.Client
	MaxResults    int
	ModelName     string
	ModelProvider string
}

type GeminiGoogleSearchTransportClient struct {
	apiKey        string
	baseURL       string
	httpClient    *http.Client
	maxResults    int
	modelName     string
	modelProvider string
}

type GeminiGoogleSearchRequest struct {
	DomainFilter       []string
	ProviderRequestRef string
	Query              string
}

type GeminiGoogleSearchResult struct {
	Snippet string
	Title   string
	URL     string
}

type GeminiGoogleSearchTransportClientResult struct {
	Body    []byte
	Err     error
	Results []GeminiGoogleSearchResult
	Status  int
	Summary ExecutionSummary
}

func NewGeminiGoogleSearchTransportClient(
	config GeminiGoogleSearchTransportClientConfig,
) *GeminiGoogleSearchTransportClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &GeminiGoogleSearchTransportClient{
		apiKey:        strings.TrimSpace(config.APIKey),
		baseURL:       strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		httpClient:    httpClient,
		maxResults:    config.MaxResults,
		modelName:     strings.TrimSpace(config.ModelName),
		modelProvider: strings.TrimSpace(config.ModelProvider),
	}
}

func (c *GeminiGoogleSearchTransportClient) Execute(
	ctx context.Context,
	request GeminiGoogleSearchRequest,
) GeminiGoogleSearchTransportClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return GeminiGoogleSearchTransportClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/interactions",
		bytes.NewReader(body),
	)
	if err != nil {
		return GeminiGoogleSearchTransportClientResult{Err: err}
	}
	httpRequest.Header.Set("x-goog-api-key", c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return GeminiGoogleSearchTransportClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return GeminiGoogleSearchTransportClientResult{Err: readErr}
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
		return GeminiGoogleSearchTransportClientResult{
			Body:    responseBody,
			Err:     fmt.Errorf("provider gemini_google_search transport status %d", response.StatusCode),
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	results, err := parseGeminiGoogleSearchPayload(responseBody)
	if err != nil {
		summary.DiagnosticStatus = DiagnosticProviderUsageMissing
		return GeminiGoogleSearchTransportClientResult{
			Body:    responseBody,
			Err:     err,
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	return GeminiGoogleSearchTransportClientResult{
		Body:    responseBody,
		Results: results,
		Status:  response.StatusCode,
		Summary: summary,
	}
}

func (c *GeminiGoogleSearchTransportClient) requestPayload(
	request GeminiGoogleSearchRequest,
) map[string]any {
	prompt := strings.TrimSpace(request.Query)
	if len(request.DomainFilter) > 0 {
		prompt = prompt + "\nOnly cite public HTTPS sources from these domains: " + strings.Join(request.DomainFilter, ", ")
	}
	return map[string]any{
		"input": prompt,
		"model": c.modelName,
		"tools": []map[string]any{{"type": "google_search"}},
	}
}

func parseGeminiGoogleSearchPayload(payload []byte) ([]GeminiGoogleSearchResult, error) {
	var decoded struct {
		Steps []struct {
			Content []struct {
				Annotations []struct {
					Title string `json:"title"`
					Type  string `json:"type"`
					URL   string `json:"url"`
				} `json:"annotations"`
				Text string `json:"text"`
				Type string `json:"type"`
			} `json:"content"`
			Type string `json:"type"`
		} `json:"steps"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("provider gemini google search response must be a JSON object: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("provider gemini google search response must not contain trailing data")
	}
	results := []GeminiGoogleSearchResult{}
	for _, step := range decoded.Steps {
		for _, content := range step.Content {
			snippet := strings.TrimSpace(content.Text)
			for _, annotation := range content.Annotations {
				if annotation.Type != "url_citation" {
					continue
				}
				title := strings.TrimSpace(annotation.Title)
				url := strings.TrimSpace(annotation.URL)
				if title == "" || url == "" {
					continue
				}
				annotationSnippet := snippet
				if annotationSnippet == "" {
					annotationSnippet = title
				}
				results = append(results, GeminiGoogleSearchResult{
					Snippet: annotationSnippet,
					Title:   title,
					URL:     url,
				})
			}
		}
	}
	if len(results) == 0 {
		return nil, fmt.Errorf("provider gemini google search response contains no sources")
	}
	return results, nil
}
