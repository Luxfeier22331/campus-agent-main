package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ResponsesClientConfig struct {
	APIKey             string
	BaseURL            string
	GenerationControls ResponsesGenerationControls
	HTTPClient         *http.Client
	ModelName          string
	ModelProvider      string
	Pricing            PricingCatalog
}

type ResponsesGenerationControls struct {
	MaxOutputTokens int
	ReasoningEffort string
	Store           *bool
	TextVerbosity   string
}

type ResponsesClient struct {
	apiKey             string
	baseURL            string
	generationControls ResponsesGenerationControls
	httpClient         *http.Client
	modelName          string
	modelProvider      string
	pricing            PricingCatalog
}

type ResponsesRequest struct {
	Input              []map[string]any
	ProviderRequestRef string
	Text               map[string]any
}

type ResponsesClientResult struct {
	Body    []byte
	Err     error
	Status  int
	Summary ExecutionSummary
}

func NewResponsesClient(config ResponsesClientConfig) *ResponsesClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &ResponsesClient{
		apiKey:             strings.TrimSpace(config.APIKey),
		baseURL:            strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		generationControls: normalizeResponsesGenerationControls(config.GenerationControls),
		httpClient:         httpClient,
		modelName:          strings.TrimSpace(config.ModelName),
		modelProvider:      strings.TrimSpace(config.ModelProvider),
		pricing:            config.Pricing,
	}
}

func (c *ResponsesClient) Execute(ctx context.Context, request ResponsesRequest) ResponsesClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return ResponsesClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/responses",
		bytes.NewReader(body),
	)
	if err != nil {
		return ResponsesClientResult{Err: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		if ctx.Err() != nil {
			return ResponsesClientResult{
				Err:     err,
				Summary: c.contextAbortSummary(startedAt, request.ProviderRequestRef, ctx.Err()),
			}
		}
		return ResponsesClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		if ctx.Err() != nil {
			return ResponsesClientResult{
				Err:     readErr,
				Summary: c.contextAbortSummary(startedAt, request.ProviderRequestRef, ctx.Err()),
			}
		}
		return ResponsesClientResult{Err: readErr}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		completedAt := time.Now().UTC()
		return ResponsesClientResult{
			Body:   responseBody,
			Err:    fmt.Errorf("provider responses status %d", response.StatusCode),
			Status: response.StatusCode,
			Summary: ExecutionSummary{
				CancelOutcome:      CancelOutcomeNotRequested,
				CompletedAt:        completedAt.Format(time.RFC3339Nano),
				DiagnosticStatus:   DiagnosticProviderHTTPError,
				LatencyMS:          completedAt.Sub(startedAt).Milliseconds(),
				ModelName:          c.modelName,
				ModelProvider:      c.modelProvider,
				ProviderRequestRef: strings.TrimSpace(request.ProviderRequestRef),
				SchemaVersion:      "provider_execution_summary_v1",
				StartedAt:          startedAt.Format(time.RFC3339Nano),
				TimeoutOutcome:     TimeoutOutcomeNotTimedOut,
			},
		}
	}
	completedAt := time.Now().UTC()
	summary, summaryErr := SummaryFromResponsesPayload(c.pricing, ResponsesSummaryInput{
		CompletedAtUnixMS:  completedAt.UnixMilli(),
		ModelName:          c.modelName,
		ModelProvider:      c.modelProvider,
		Payload:            responseBody,
		ProviderRequestRef: request.ProviderRequestRef,
		StartedAtUnixMS:    startedAt.UnixMilli(),
	})
	if summaryErr != nil {
		return ResponsesClientResult{Body: responseBody, Err: summaryErr}
	}
	return ResponsesClientResult{Body: responseBody, Status: response.StatusCode, Summary: summary}
}

func (c *ResponsesClient) contextAbortSummary(
	startedAt time.Time,
	providerRequestRef string,
	ctxErr error,
) ExecutionSummary {
	cancelOutcome := CancelOutcomeProviderConnectionAborted
	timeoutOutcome := TimeoutOutcomeNotTimedOut
	if errors.Is(ctxErr, context.DeadlineExceeded) {
		cancelOutcome = CancelOutcomeNotRequested
		timeoutOutcome = TimeoutOutcomeProviderTimeout
	}
	return ExecutionSummary{
		CancelOutcome:      cancelOutcome,
		ModelName:          c.modelName,
		ModelProvider:      c.modelProvider,
		ProviderRequestRef: strings.TrimSpace(providerRequestRef),
		SchemaVersion:      "provider_execution_summary_v1",
		StartedAt:          startedAt.Format(time.RFC3339Nano),
		TimeoutOutcome:     timeoutOutcome,
	}
}

func (c *ResponsesClient) requestPayload(request ResponsesRequest) map[string]any {
	payload := map[string]any{
		"model":  c.modelName,
		"stream": false,
		"input":  request.Input,
	}
	if c.generationControls.MaxOutputTokens > 0 {
		payload["max_output_tokens"] = c.generationControls.MaxOutputTokens
	}
	if strings.TrimSpace(c.generationControls.ReasoningEffort) != "" {
		payload["reasoning"] = map[string]any{"effort": c.generationControls.ReasoningEffort}
	}
	if c.generationControls.Store != nil {
		payload["store"] = *c.generationControls.Store
	}
	if request.Text != nil {
		text := cloneMap(request.Text)
		if strings.TrimSpace(c.generationControls.TextVerbosity) != "" {
			text["verbosity"] = c.generationControls.TextVerbosity
		}
		payload["text"] = text
	}
	return payload
}

func normalizeResponsesGenerationControls(value ResponsesGenerationControls) ResponsesGenerationControls {
	return ResponsesGenerationControls{
		MaxOutputTokens: value.MaxOutputTokens,
		ReasoningEffort: strings.TrimSpace(value.ReasoningEffort),
		Store:           value.Store,
		TextVerbosity:   strings.TrimSpace(value.TextVerbosity),
	}
}

func cloneMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	cloned := make(map[string]any, len(value))
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}
