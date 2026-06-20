package httpapi

import (
	"context"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *Server) attachRunUsageSummary(
	ctx context.Context,
	runID string,
	response map[string]any,
) (map[string]any, error) {
	if s == nil || s.runProjectionStore == nil {
		return nil, execution.ErrRunProjectionStoreNotConfigured
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, runID)
	if err != nil {
		return nil, err
	}
	summary := execution.SummarizeRunUsage(attempts)
	if summary.BillableStepCount == 0 {
		return response, nil
	}
	observability, _ := response["observability"].(map[string]any)
	if observability == nil {
		observability = map[string]any{}
		response["observability"] = observability
	}
	observability["usage_summary"] = runUsageSummaryWire(summary)
	return response, nil
}

func runUsageSummaryWire(summary execution.RunUsageSummary) map[string]any {
	modelUsage := make([]map[string]any, 0, len(summary.ModelUsage))
	for _, usage := range summary.ModelUsage {
		modelUsage = append(modelUsage, modelUsageSummaryWire(usage))
	}
	return map[string]any{
		"billable_step_count":     summary.BillableStepCount,
		"cached_input_tokens":     summary.CachedInputTokens,
		"estimated_cost_microusd": summary.EstimatedCostMicroUSD,
		"input_tokens":            summary.InputTokens,
		"model_name":              nullableTrimmedString(summary.ModelName),
		"model_provider":          nullableTrimmedString(summary.ModelProvider),
		"model_usage":             modelUsage,
		"output_tokens":           summary.OutputTokens,
	}
}

func modelUsageSummaryWire(usage execution.ModelUsageSummary) map[string]any {
	return map[string]any{
		"cached_input_tokens":     usage.CachedInputTokens,
		"estimated_cost_microusd": usage.EstimatedCostMicroUSD,
		"input_tokens":            usage.InputTokens,
		"model_name":              nullableTrimmedString(usage.ModelName),
		"model_provider":          nullableTrimmedString(usage.ModelProvider),
		"output_tokens":           usage.OutputTokens,
		"step_count":              usage.StepCount,
	}
}

func nullableTrimmedString(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
