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

type ChatCompletionsClientConfig struct {
	APIKey        string
	BaseURL       string
	HTTPClient    *http.Client
	MaxTokens     int
	ModelName     string
	ModelProvider string
}

type ChatCompletionsClient struct {
	apiKey        string
	baseURL       string
	httpClient    *http.Client
	maxTokens     int
	modelName     string
	modelProvider string
}

type ChatCompletionMessage struct {
	Content string `json:"content"`
	Role    string `json:"role"`
}

type ChatCompletionsRequest struct {
	Messages           []ChatCompletionMessage
	ProviderRequestRef string
}

type ChatCompletionsClientResult struct {
	Body    []byte
	Err     error
	Status  int
	Summary ExecutionSummary
	Text    string
}

func NewChatCompletionsClient(config ChatCompletionsClientConfig) *ChatCompletionsClient {
	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	return &ChatCompletionsClient{
		apiKey:        strings.TrimSpace(config.APIKey),
		baseURL:       strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"),
		httpClient:    httpClient,
		maxTokens:     config.MaxTokens,
		modelName:     strings.TrimSpace(config.ModelName),
		modelProvider: strings.TrimSpace(config.ModelProvider),
	}
}

func (c *ChatCompletionsClient) Execute(
	ctx context.Context,
	request ChatCompletionsRequest,
) ChatCompletionsClientResult {
	startedAt := time.Now().UTC()
	body, err := json.Marshal(c.requestPayload(request))
	if err != nil {
		return ChatCompletionsClientResult{Err: err}
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.baseURL+"/chat/completions",
		bytes.NewReader(body),
	)
	if err != nil {
		return ChatCompletionsClientResult{Err: err}
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return ChatCompletionsClientResult{Err: err}
	}
	defer func() {
		_ = response.Body.Close()
	}()
	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return ChatCompletionsClientResult{Err: readErr}
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
		return ChatCompletionsClientResult{
			Body:    responseBody,
			Err:     fmt.Errorf("provider chat completions status %d", response.StatusCode),
			Status:  response.StatusCode,
			Summary: summary,
		}
	}
	text, providerResponseID, usage := parseChatCompletionsPayload(responseBody)
	summary.ProviderResponseID = providerResponseID
	summary.InputTokens = usage.InputTokens
	summary.OutputTokens = usage.OutputTokens
	summary.CachedInputTokens = usage.CachedInputTokens
	return ChatCompletionsClientResult{
		Body:    responseBody,
		Status:  response.StatusCode,
		Summary: summary,
		Text:    text,
	}
}

func (c *ChatCompletionsClient) requestPayload(request ChatCompletionsRequest) map[string]any {
	payload := map[string]any{
		"model":    c.modelName,
		"stream":   false,
		"messages": request.Messages,
	}
	if c.maxTokens > 0 {
		payload["max_tokens"] = c.maxTokens
	}
	return payload
}

func parseChatCompletionsPayload(payload []byte) (string, string, Usage) {
	var decoded struct {
		ID      string `json:"id"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			CompletionTokens int64 `json:"completion_tokens"`
			PromptTokens     int64 `json:"prompt_tokens"`
			PromptDetails    struct {
				CachedTokens int64 `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
			TotalTokens int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return "", "", Usage{}
	}
	text := ""
	if len(decoded.Choices) > 0 {
		text = strings.TrimSpace(decoded.Choices[0].Message.Content)
	}
	return text, strings.TrimSpace(decoded.ID), Usage{
		CachedInputTokens: decoded.Usage.PromptDetails.CachedTokens,
		InputTokens:       decoded.Usage.PromptTokens,
		OutputTokens:      decoded.Usage.CompletionTokens,
	}
}
