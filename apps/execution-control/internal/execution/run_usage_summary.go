package execution

import (
	"sort"
	"strings"
)

type ModelUsageSummary struct {
	ModelProvider         string
	ModelName             string
	StepCount             int
	InputTokens           int64
	OutputTokens          int64
	CachedInputTokens     int64
	EstimatedCostMicroUSD int64
}

type RunUsageSummary struct {
	BillableStepCount     int
	InputTokens           int64
	OutputTokens          int64
	CachedInputTokens     int64
	EstimatedCostMicroUSD int64
	ModelProvider         string
	ModelName             string
	ModelUsage            []ModelUsageSummary
}

func SummarizeRunUsage(attempts []StepAttemptProjection) RunUsageSummary {
	summary := RunUsageSummary{}
	byModel := map[string]*ModelUsageSummary{}
	for _, attempt := range attempts {
		if !stepAttemptHasBillableModelUsage(attempt) {
			continue
		}
		modelProvider := strings.TrimSpace(attempt.ModelProvider)
		modelName := strings.TrimSpace(attempt.ModelName)
		summary.BillableStepCount++
		summary.InputTokens += attempt.InputTokens
		summary.OutputTokens += attempt.OutputTokens
		summary.CachedInputTokens += attempt.CachedInputTokens
		summary.EstimatedCostMicroUSD += attempt.EstimatedCostMicroUSD
		key := modelProvider + "\x00" + modelName
		modelUsage := byModel[key]
		if modelUsage == nil {
			modelUsage = &ModelUsageSummary{
				ModelProvider: modelProvider,
				ModelName:     modelName,
			}
			byModel[key] = modelUsage
		}
		modelUsage.StepCount++
		modelUsage.InputTokens += attempt.InputTokens
		modelUsage.OutputTokens += attempt.OutputTokens
		modelUsage.CachedInputTokens += attempt.CachedInputTokens
		modelUsage.EstimatedCostMicroUSD += attempt.EstimatedCostMicroUSD
	}
	if len(byModel) == 1 {
		for _, usage := range byModel {
			summary.ModelProvider = usage.ModelProvider
			summary.ModelName = usage.ModelName
		}
	}
	keys := make([]string, 0, len(byModel))
	for key := range byModel {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		leftProvider, leftModel, _ := strings.Cut(keys[i], "\x00")
		rightProvider, rightModel, _ := strings.Cut(keys[j], "\x00")
		if leftProvider == rightProvider {
			return leftModel < rightModel
		}
		return leftProvider < rightProvider
	})
	summary.ModelUsage = make([]ModelUsageSummary, 0, len(keys))
	for _, key := range keys {
		summary.ModelUsage = append(summary.ModelUsage, *byModel[key])
	}
	return summary
}

func stepAttemptHasBillableModelUsage(attempt StepAttemptProjection) bool {
	if strings.TrimSpace(attempt.ModelProvider) == "" &&
		strings.TrimSpace(attempt.ModelName) == "" &&
		strings.TrimSpace(attempt.ProviderResponseID) == "" {
		return false
	}
	return attempt.InputTokens > 0 ||
		attempt.OutputTokens > 0 ||
		attempt.CachedInputTokens > 0 ||
		attempt.EstimatedCostMicroUSD > 0
}
