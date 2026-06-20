package execution

import "testing"

func TestSummarizeRunUsageAggregatesBillableStepAttempts(t *testing.T) {
	summary := SummarizeRunUsage([]StepAttemptProjection{
		{
			StepID:                "memory.recall",
			InputTokens:           0,
			OutputTokens:          0,
			CachedInputTokens:     0,
			EstimatedCostMicroUSD: 0,
		},
		{
			StepID:                "agent.primary",
			ModelProvider:         "openai",
			ModelName:             "gpt-5.5",
			InputTokens:           11268,
			OutputTokens:          494,
			CachedInputTokens:     0,
			EstimatedCostMicroUSD: 0,
			ProviderResponseID:    "resp_primary",
		},
		{
			StepID:                "synthesis",
			ModelProvider:         "openai",
			ModelName:             "gpt-5.5",
			InputTokens:           7282,
			OutputTokens:          817,
			CachedInputTokens:     12,
			EstimatedCostMicroUSD: 60920,
			PricingVersion:        "provider-pricing-v1",
			ProviderResponseID:    "resp_synthesis",
		},
	})

	if summary.BillableStepCount != 2 {
		t.Fatalf("billable step count = %d, want 2", summary.BillableStepCount)
	}
	if summary.InputTokens != 18550 ||
		summary.OutputTokens != 1311 ||
		summary.CachedInputTokens != 12 ||
		summary.EstimatedCostMicroUSD != 60920 {
		t.Fatalf("summary = %#v, want aggregated token and cost totals", summary)
	}
	if summary.ModelProvider != "openai" || summary.ModelName != "gpt-5.5" {
		t.Fatalf("single model summary = %#v, want scalar model openai/gpt-5.5", summary)
	}
	if len(summary.ModelUsage) != 1 {
		t.Fatalf("model usage count = %d, want 1", len(summary.ModelUsage))
	}
	if summary.ModelUsage[0].StepCount != 2 ||
		summary.ModelUsage[0].InputTokens != 18550 ||
		summary.ModelUsage[0].OutputTokens != 1311 ||
		summary.ModelUsage[0].EstimatedCostMicroUSD != 60920 {
		t.Fatalf("model usage = %#v, want aggregated model usage", summary.ModelUsage[0])
	}
}

func TestSummarizeRunUsageLeavesScalarModelEmptyForMixedModels(t *testing.T) {
	summary := SummarizeRunUsage([]StepAttemptProjection{
		{
			StepID:             "agent.primary",
			ModelProvider:      "openai",
			ModelName:          "gpt-5.5",
			InputTokens:        10,
			ProviderResponseID: "resp_primary",
		},
		{
			StepID:             "synthesis",
			ModelProvider:      "openai",
			ModelName:          "gpt-4.1",
			OutputTokens:       20,
			ProviderResponseID: "resp_synthesis",
		},
	})

	if summary.ModelProvider != "" || summary.ModelName != "" {
		t.Fatalf("mixed scalar model = %q/%q, want empty", summary.ModelProvider, summary.ModelName)
	}
	if len(summary.ModelUsage) != 2 {
		t.Fatalf("model usage count = %d, want 2", len(summary.ModelUsage))
	}
	if summary.ModelUsage[0].ModelName != "gpt-4.1" ||
		summary.ModelUsage[1].ModelName != "gpt-5.5" {
		t.Fatalf("model usage order = %#v, want deterministic model/provider order", summary.ModelUsage)
	}
}
