package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func projectedRAGForEval(results []execution.StepResultProjection) map[string]any {
	rag := map[string]any{"answer": projectedRAGAnswer(results)}
	contexts, contextIDs := projectedRAGRetrievedContexts(results)
	rag["retrieved_contexts"] = stringsToAny(contexts)
	rag["retrieved_context_ids"] = stringsToAny(contextIDs)
	return rag
}

func projectedRAGAnswer(results []execution.StepResultProjection) string {
	for _, result := range results {
		if result.StepID != "finalization.write" {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		finalized := optionalMapFromMap(payload, "finalized_response")
		if answer := firstNonEmptyText(finalized["answer_text"]); answer != "" {
			return answer
		}
	}
	return ""
}

func projectedRAGRetrievedContexts(results []execution.StepResultProjection) ([]string, []string) {
	contexts := []string{}
	contextIDs := []string{}
	seen := map[string]struct{}{}
	for _, result := range results {
		if !strings.HasPrefix(result.StepID, "sdk_tool.execute.campus_search.") ||
			result.Status != "completed" {
			continue
		}
		payload := sanitizeProjectionPayload(result.SanitizedPayload)
		_, evidence, err := decodeCampusSearchResult(cloneAnyMapFromMetadata(payload["result"]))
		if err != nil {
			continue
		}
		for _, item := range evidence {
			if item.Text == "" || item.EvidenceRef == "" {
				continue
			}
			if _, duplicate := seen[item.EvidenceRef]; duplicate {
				continue
			}
			seen[item.EvidenceRef] = struct{}{}
			contexts = append(contexts, item.Text)
			contextIDs = append(contextIDs, item.EvidenceRef)
		}
	}
	return contexts, contextIDs
}

func stringsToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}
