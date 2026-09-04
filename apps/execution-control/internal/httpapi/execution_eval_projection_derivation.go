package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func projectedRAGForEval(results []execution.StepResultProjection) map[string]any {
	answer := projectedRAGAnswer(results)
	rag := map[string]any{"answer": answer}
	contexts, contextIDs := projectedRAGRetrievedContexts(results)
	rag["retrieved_contexts"] = stringsToAny(contexts)
	rag["retrieved_context_ids"] = stringsToAny(contextIDs)
	citedContexts, citedContextIDs := projectedRAGCitedContexts(answer, results)
	rag["cited_contexts"] = stringsToAny(citedContexts)
	rag["cited_context_ids"] = stringsToAny(citedContextIDs)
	return rag
}

func projectedRAGAnswer(results []execution.StepResultProjection) string {
	for _, result := range results {
		if result.StepID != "finalization.write" {
			continue
		}
		payload := execution.CloneAnyMap(result.SanitizedPayload)
		finalized := execution.OptionalMapFromMap(payload, "finalization_summary")
		if answer := execution.FirstNonEmptyText(finalized["answer_text"]); answer != "" {
			return answer
		}
	}
	return ""
}

func projectedRAGRetrievedContexts(results []execution.StepResultProjection) ([]string, []string) {
	contexts := []string{}
	contextIDs := []string{}
	seen := map[string]struct{}{}
	for _, item := range projectedRAGSearchResults(results) {
		if item.Text == "" || item.ResultRef == "" {
			continue
		}
		if _, duplicate := seen[item.ResultRef]; duplicate {
			continue
		}
		seen[item.ResultRef] = struct{}{}
		contexts = append(contexts, item.Text)
		contextIDs = append(contextIDs, item.ResultRef)
	}
	return contexts, contextIDs
}

func projectedRAGCitedContexts(
	answer string,
	results []execution.StepResultProjection,
) ([]string, []string) {
	cited, err := campusdocs.CitedSearchResults(answer, projectedRAGSearchResults(results))
	if err != nil {
		return []string{}, []string{}
	}
	contexts := make([]string, 0, len(cited))
	contextIDs := make([]string, 0, len(cited))
	for _, item := range cited {
		contexts = append(contexts, item.Text)
		contextIDs = append(contextIDs, item.ResultRef)
	}
	return contexts, contextIDs
}

func projectedRAGSearchResults(results []execution.StepResultProjection) []campusdocs.SearchResultItem {
	projected := []campusdocs.SearchResultItem{}
	for _, result := range results {
		if !strings.HasPrefix(result.StepID, "sdk_tool.execute.campus_search.") ||
			result.Status != "completed" {
			continue
		}
		payload := execution.CloneAnyMap(result.SanitizedPayload)
		_, searchResults, err := campusdocs.DecodeSearchResult(execution.CloneAnyMapFromValue(payload["result"]))
		if err != nil {
			continue
		}
		projected = append(projected, searchResults...)
	}
	return projected
}

func stringsToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}
