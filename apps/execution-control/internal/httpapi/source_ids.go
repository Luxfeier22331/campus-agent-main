package httpapi

import (
	"sort"
	"strings"
)

func workflowSourceIDs(result map[string]any) []string {
	ids := []string{}
	collectWorkflowSourceIDs(result, &ids)
	sort.Strings(ids)
	return ids
}

func collectWorkflowSourceIDs(value any, ids *[]string) {
	switch current := value.(type) {
	case map[string]any:
		for key, item := range current {
			switch key {
			case "doc_id", "docId", "source_id", "sourceId", "source_ref", "sourceRef",
				"notice_id", "noticeId":
				appendWorkflowSourceID(ids, stringValue(item))
			case "source_ids", "sourceIds", "evidence_ids", "evidenceIds", "related_notice_refs",
				"relatedNoticeRefs", "source_refs", "sourceRefs", "notice_refs", "noticeRefs",
				"override_source_refs", "overrideSourceRefs":
				for _, sourceID := range stringSliceFromAny(item) {
					appendWorkflowSourceID(ids, sourceID)
				}
			}
			collectWorkflowSourceIDs(item, ids)
		}
	case []any:
		for _, item := range current {
			collectWorkflowSourceIDs(item, ids)
		}
	case []string:
		for _, item := range current {
			appendWorkflowSourceID(ids, item)
		}
	}
}

func appendWorkflowSourceID(ids *[]string, id string) {
	normalized := strings.TrimSpace(id)
	if normalized == "" || containsString(*ids, normalized) {
		return
	}
	*ids = append(*ids, normalized)
}
