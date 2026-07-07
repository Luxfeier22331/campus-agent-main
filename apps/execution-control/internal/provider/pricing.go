package provider

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
)

var ErrProviderPricingMissing = errors.New("provider pricing missing")

type Usage struct {
	CachedInputTokens int64
	InputTokens       int64
	ModelName         string
	ModelProvider     string
	OutputTokens      int64
}

type PricingCatalog struct {
	Currency      string         `json:"currency"`
	Models        []ModelPricing `json:"models"`
	SchemaVersion string         `json:"schema_version"`
}

type ModelPricing struct {
	CachedInputMicroUSDPer1KTokens int64  `json:"cached_input_microusd_per_1k_tokens"`
	InputMicroUSDPer1KTokens       int64  `json:"input_microusd_per_1k_tokens"`
	Model                          string `json:"model"`
	OutputMicroUSDPer1KTokens      int64  `json:"output_microusd_per_1k_tokens"`
	Provider                       string `json:"provider"`
}

func LoadPricingCatalog(path string) (PricingCatalog, error) {
	normalizedPath := strings.TrimSpace(path)
	if normalizedPath == "" {
		return PricingCatalog{}, fmt.Errorf("%w: pricing catalog path is required", ErrProviderPricingMissing)
	}
	raw, err := os.ReadFile(normalizedPath)
	if err != nil {
		return PricingCatalog{}, fmt.Errorf("read provider pricing catalog: %w", err)
	}
	var catalog PricingCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return PricingCatalog{}, fmt.Errorf("parse provider pricing catalog: %w", err)
	}
	if strings.TrimSpace(catalog.SchemaVersion) != "provider-pricing-v1" {
		return PricingCatalog{}, fmt.Errorf(
			"%w: unsupported schema_version %q",
			ErrProviderPricingMissing,
			catalog.SchemaVersion,
		)
	}
	if strings.TrimSpace(catalog.Currency) != "USD" {
		return PricingCatalog{}, fmt.Errorf("%w: currency must be USD", ErrProviderPricingMissing)
	}
	for _, model := range catalog.Models {
		if strings.TrimSpace(model.Provider) == "" || strings.TrimSpace(model.Model) == "" {
			return PricingCatalog{}, fmt.Errorf("%w: provider and model are required", ErrProviderPricingMissing)
		}
		for _, value := range []int64{
			model.InputMicroUSDPer1KTokens,
			model.CachedInputMicroUSDPer1KTokens,
			model.OutputMicroUSDPer1KTokens,
		} {
			if value < 0 {
				return PricingCatalog{}, fmt.Errorf("%w: pricing values must be non-negative", ErrProviderPricingMissing)
			}
		}
	}
	return catalog, nil
}

func (c PricingCatalog) EstimateCostMicroUSD(usage Usage) (int64, error) {
	model, ok := c.Lookup(usage.ModelProvider, usage.ModelName)
	if !ok {
		return 0, fmt.Errorf(
			"%w: %s/%s",
			ErrProviderPricingMissing,
			strings.TrimSpace(usage.ModelProvider),
			strings.TrimSpace(usage.ModelName),
		)
	}
	if usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CachedInputTokens < 0 {
		return 0, fmt.Errorf("%w: usage tokens must be non-negative", ErrProviderPricingMissing)
	}
	uncachedInputTokens := usage.InputTokens - usage.CachedInputTokens
	if uncachedInputTokens < 0 {
		uncachedInputTokens = 0
	}
	return microUSDCost(uncachedInputTokens, model.InputMicroUSDPer1KTokens) +
		microUSDCost(usage.CachedInputTokens, model.CachedInputMicroUSDPer1KTokens) +
		microUSDCost(usage.OutputTokens, model.OutputMicroUSDPer1KTokens), nil
}

func (c PricingCatalog) Lookup(provider string, model string) (ModelPricing, bool) {
	normalizedProvider := strings.TrimSpace(provider)
	normalizedModel := strings.TrimSpace(model)
	for _, candidate := range c.Models {
		if strings.TrimSpace(candidate.Provider) == normalizedProvider &&
			strings.TrimSpace(candidate.Model) == normalizedModel {
			return candidate, true
		}
	}
	return ModelPricing{}, false
}

func microUSDCost(tokens int64, microUSDPer1KTokens int64) int64 {
	if tokens <= 0 || microUSDPer1KTokens <= 0 {
		return 0
	}
	return (tokens*microUSDPer1KTokens + 999) / 1000
}
