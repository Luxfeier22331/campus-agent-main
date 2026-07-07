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

type PerplexitySearchTransportClientConfig struct {
	APIKey        string
	BaseURL       string
	HTTPClient    *http.Client
	MaxResults    int
	ModelName     string
	ModelProvider string
}

type PerplexitySearchTransportClient struct {
	apiKey        string
	baseURL       string
	httpClient    *http.Client
	maxResults    int
	modelName     string
	modelProvider string
}

type PerplexitySearchRequest struct {
	DomainFilter       []string
	ProviderRequestRef string
	Query              string
}

type PerplexitySearchResult struct {
	Date        string `json:"date"`
	LastUpdated string `json:"last_updated"`
	Snippet     string `json:"snippet"`
	Title       string `json:"title"`
	URL         string `json:"url"`
}

type PerplexitySearchTransportClientResult struct {
	Body    []byte
	Err     error
	Results []PerplexitySearchResult
	Status  int
	Summary ExecutionSummary
}

func NewPerplexitySearchTransportClient(
	config PerplexitySearchTransportClientConfig,
) *PerplexitySearchTransportClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &PerplexitySearchTransportClient{
		apiKey:        strings.TrimSpace(config.APIKey),
		baseURL:       strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		httpClient:    httpClient,
		maxResults:    config.MaxResults,
		modelName:     strings.TrimSpace(config.ModelName),
		modelProvider: strings.TrimSpace(config.ModelProvider),
	}
}

func (c *PerplexitySearchTransportClient) Execute(
	ctx context.Context,
	request PerplexitySearchRequest,
) PerplexitySearchTransportClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return PerplexitySearchTransportClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/search",
		bytes.NewReader(body),
	)
	if err != nil {
		return PerplexitySearchTransportClientResult{Err: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return PerplexitySearchTransportClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return PerplexitySearchTransportClientResult{Err: readErr}
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
		return PerplexitySearchTransportClientResult{
			Body:    responseBody,
			Err:     fmt.Errorf("provider perplexity_search transport status %d", response.StatusCode),
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	results, err := parsePerplexitySearchPayload(responseBody)
	if err != nil {
		summary.DiagnosticStatus = DiagnosticProviderUsageMissing
		return PerplexitySearchTransportClientResult{
			Body:    responseBody,
			Err:     err,
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	return PerplexitySearchTransportClientResult{
		Body:    responseBody,
		Results: results,
		Status:  response.StatusCode,
		Summary: summary,
	}
}

func (c *PerplexitySearchTransportClient) requestPayload(
	request PerplexitySearchRequest,
) map[string]any {
	payload := map[string]any{
		"query":                strings.TrimSpace(request.Query),
		"search_domain_filter": request.DomainFilter,
	}
	if c.maxResults > 0 {
		payload["max_results"] = c.maxResults
	}
	return payload
}

func parsePerplexitySearchPayload(payload []byte) ([]PerplexitySearchResult, error) {
	var decoded struct {
		Results []PerplexitySearchResult `json:"results"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&decoded); err != nil {
		return nil, fmt.Errorf("provider search response must be a strict JSON object: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, fmt.Errorf("provider search response must not contain trailing data")
	}
	if len(decoded.Results) == 0 {
		return nil, fmt.Errorf("provider search response contains no results")
	}
	return decoded.Results, nil
}
