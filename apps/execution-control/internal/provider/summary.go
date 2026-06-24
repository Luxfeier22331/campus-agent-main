package provider

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	CancelOutcomeNotRequested              = "not_requested"
	CancelOutcomeProviderConnectionAborted = "provider_connection_aborted"
	TimeoutOutcomeNotTimedOut              = "not_timed_out"
	TimeoutOutcomeProviderTimeout          = "provider_timeout"

	DiagnosticComplete             = "complete"
	DiagnosticProviderUsageMissing = "provider_usage_missing"
	DiagnosticProviderHTTPError    = "provider_http_error"
)

type ResponsesSummaryInput struct {
	CancelOutcome      string
	CompletedAtUnixMS  int64
	ModelName          string
	ModelProvider      string
	Payload            []byte
	ProviderRequestRef string
	StartedAtUnixMS    int64
	TimeoutOutcome     string
}

type ExecutionSummary struct {
	CachedInputTokens     int64  `json:"cached_input_tokens"`
	CancelOutcome         string `json:"cancel_outcome"`
	CompletedAt           string `json:"completed_at"`
	DiagnosticStatus      string `json:"diagnostic_status"`
	EstimatedCostMicroUSD int64  `json:"estimated_cost_microusd"`
	InputTokens           int64  `json:"input_tokens"`
	LatencyMS             int64  `json:"latency_ms"`
	ModelName             string `json:"model_name"`
	ModelProvider         string `json:"model_provider"`
	OutputTokens          int64  `json:"output_tokens"`
	PricingVersion        string `json:"pricing_version"`
	ProviderRequestRef    string `json:"provider_request_ref"`
	ProviderResponseID    string `json:"provider_response_id"`
	SchemaVersion         string `json:"schema_version"`
	StartedAt             string `json:"started_at"`
	TimeoutOutcome        string `json:"timeout_outcome"`
}

func SummaryFromResponsesPayload(
	catalog PricingCatalog,
	input ResponsesSummaryInput,
) (ExecutionSummary, error) {
	var payload responsesPayload
	if err := json.Unmarshal(input.Payload, &payload); err != nil {
		return ExecutionSummary{}, fmt.Errorf("parse responses payload: %w", err)
	}
	modelProvider := strings.TrimSpace(input.ModelProvider)
	modelName := strings.TrimSpace(input.ModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(payload.Model)
	}
	if _, ok := catalog.Lookup(modelProvider, modelName); !ok {
		return ExecutionSummary{}, fmt.Errorf(
			"%w: %s/%s",
			ErrProviderPricingMissing,
			modelProvider,
			modelName,
		)
	}

	summary := ExecutionSummary{
		CancelOutcome:      defaultSummaryString(input.CancelOutcome, CancelOutcomeNotRequested),
		CompletedAt:        unixMillisRFC3339(input.CompletedAtUnixMS),
		DiagnosticStatus:   DiagnosticComplete,
		ModelName:          modelName,
		ModelProvider:      modelProvider,
		PricingVersion:     catalog.SchemaVersion,
		ProviderRequestRef: strings.TrimSpace(input.ProviderRequestRef),
		ProviderResponseID: strings.TrimSpace(payload.ID),
		SchemaVersion:      "provider_execution_summary_v1",
		StartedAt:          unixMillisRFC3339(input.StartedAtUnixMS),
		TimeoutOutcome:     defaultSummaryString(input.TimeoutOutcome, TimeoutOutcomeNotTimedOut),
	}
	if input.StartedAtUnixMS > 0 &&
		input.CompletedAtUnixMS >= input.StartedAtUnixMS {
		summary.LatencyMS = input.CompletedAtUnixMS - input.StartedAtUnixMS
	}
	if payload.Usage == nil {
		summary.DiagnosticStatus = DiagnosticProviderUsageMissing
		return summary, nil
	}
	summary.InputTokens = payload.Usage.InputTokens
	summary.OutputTokens = payload.Usage.OutputTokens
	summary.CachedInputTokens = payload.Usage.InputTokensDetails.CachedTokens
	cost, err := catalog.EstimateCostMicroUSD(Usage{
		CachedInputTokens: summary.CachedInputTokens,
		InputTokens:       summary.InputTokens,
		ModelName:         summary.ModelName,
		ModelProvider:     summary.ModelProvider,
		OutputTokens:      summary.OutputTokens,
	})
	if err != nil {
		return ExecutionSummary{}, err
	}
	summary.EstimatedCostMicroUSD = cost
	return summary, nil
}

type responsesPayload struct {
	ID    string          `json:"id"`
	Model string          `json:"model"`
	Usage *responsesUsage `json:"usage"`
}

type responsesUsage struct {
	InputTokens        int64                      `json:"input_tokens"`
	InputTokensDetails responsesInputTokenDetails `json:"input_tokens_details"`
	OutputTokens       int64                      `json:"output_tokens"`
}

type responsesInputTokenDetails struct {
	CachedTokens int64 `json:"cached_tokens"`
}

func unixMillisRFC3339(value int64) string {
	if value <= 0 {
		return ""
	}
	return time.UnixMilli(value).UTC().Format(time.RFC3339Nano)
}

func defaultSummaryString(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return fallback
}
