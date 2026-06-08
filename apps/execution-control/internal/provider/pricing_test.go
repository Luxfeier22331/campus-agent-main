package provider

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPricingCatalogComputesEstimatedCost(t *testing.T) {
	path := writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`)
	catalog, err := LoadPricingCatalog(path)
	if err != nil {
		t.Fatalf("load pricing catalog: %v", err)
	}

	cost, err := catalog.EstimateCostMicroUSD(Usage{
		CachedInputTokens: 200,
		InputTokens:       1000,
		ModelName:         "gpt-5-mini",
		ModelProvider:     "openai",
		OutputTokens:      500,
	})
	if err != nil {
		t.Fatalf("estimate cost: %v", err)
	}

	if cost != 1205 {
		t.Fatalf("estimated cost = %d, want 1205", cost)
	}
	if catalog.SchemaVersion != "provider-pricing-v1" {
		t.Fatalf("schema version = %q", catalog.SchemaVersion)
	}
}

func TestPricingCatalogFailsClosedForMissingAdmittedModel(t *testing.T) {
	path := writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[]
	}`)
	catalog, err := LoadPricingCatalog(path)
	if err != nil {
		t.Fatalf("load pricing catalog: %v", err)
	}

	_, err = catalog.EstimateCostMicroUSD(Usage{
		InputTokens:   1,
		ModelName:     "gpt-5-mini",
		ModelProvider: "openai",
	})
	if err == nil {
		t.Fatal("missing admitted model pricing must fail closed")
	}
}

func TestProviderExecutionSummaryFromResponsesPayloadComputesCost(t *testing.T) {
	path := writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`)
	catalog, err := LoadPricingCatalog(path)
	if err != nil {
		t.Fatalf("load pricing catalog: %v", err)
	}

	summary, err := SummaryFromResponsesPayload(catalog, ResponsesSummaryInput{
		ModelName:          "gpt-5-mini",
		ModelProvider:      "openai",
		ProviderRequestRef: "provider://requests/run-123/synthesis",
		StartedAtUnixMS:    1710000000000,
		CompletedAtUnixMS:  1710000001234,
		Payload: []byte(`{
			"id":"resp_123",
			"model":"gpt-5-mini",
			"usage":{
				"input_tokens":1000,
				"output_tokens":500,
				"input_tokens_details":{"cached_tokens":200}
			}
		}`),
	})
	if err != nil {
		t.Fatalf("build provider summary: %v", err)
	}

	if summary.SchemaVersion != "provider_execution_summary_v1" {
		t.Fatalf("schema version = %q", summary.SchemaVersion)
	}
	if summary.ProviderResponseID != "resp_123" {
		t.Fatalf("provider response id = %q", summary.ProviderResponseID)
	}
	if summary.LatencyMS != 1234 {
		t.Fatalf("latency = %d, want 1234", summary.LatencyMS)
	}
	if summary.InputTokens != 1000 || summary.OutputTokens != 500 || summary.CachedInputTokens != 200 {
		t.Fatalf(
			"usage = input %d output %d cached %d",
			summary.InputTokens,
			summary.OutputTokens,
			summary.CachedInputTokens,
		)
	}
	if summary.EstimatedCostMicroUSD != 1205 {
		t.Fatalf("estimated cost = %d, want 1205", summary.EstimatedCostMicroUSD)
	}
	if summary.PricingVersion != "provider-pricing-v1" {
		t.Fatalf("pricing version = %q", summary.PricingVersion)
	}
	if summary.CancelOutcome != CancelOutcomeNotRequested {
		t.Fatalf("cancel outcome = %q", summary.CancelOutcome)
	}
	if summary.TimeoutOutcome != TimeoutOutcomeNotTimedOut {
		t.Fatalf("timeout outcome = %q", summary.TimeoutOutcome)
	}
	if summary.DiagnosticStatus != DiagnosticComplete {
		t.Fatalf("diagnostic status = %q", summary.DiagnosticStatus)
	}
}

func TestProviderExecutionSummaryMarksMissingUsageIncomplete(t *testing.T) {
	path := writePricingCatalogForTest(t, `{
		"schema_version":"provider-pricing-v1",
		"currency":"USD",
		"models":[{
			"provider":"openai",
			"model":"gpt-5-mini",
			"input_microusd_per_1k_tokens":250,
			"cached_input_microusd_per_1k_tokens":25,
			"output_microusd_per_1k_tokens":2000
		}]
	}`)
	catalog, err := LoadPricingCatalog(path)
	if err != nil {
		t.Fatalf("load pricing catalog: %v", err)
	}

	summary, err := SummaryFromResponsesPayload(catalog, ResponsesSummaryInput{
		ModelName:          "gpt-5-mini",
		ModelProvider:      "openai",
		ProviderRequestRef: "provider://requests/run-123/synthesis",
		Payload:            []byte(`{"id":"resp_missing_usage","model":"gpt-5-mini"}`),
	})
	if err != nil {
		t.Fatalf("missing usage should produce incomplete diagnostic summary, got error: %v", err)
	}

	if summary.ProviderResponseID != "resp_missing_usage" {
		t.Fatalf("provider response id = %q", summary.ProviderResponseID)
	}
	if summary.DiagnosticStatus != DiagnosticProviderUsageMissing {
		t.Fatalf("diagnostic status = %q", summary.DiagnosticStatus)
	}
	if summary.EstimatedCostMicroUSD != 0 {
		t.Fatalf("missing usage cost = %d, want 0", summary.EstimatedCostMicroUSD)
	}
}

func writePricingCatalogForTest(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "provider-pricing.v1.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write pricing catalog: %v", err)
	}
	return path
}
