package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func workflowHandoffPayloadSummary(handoff *execution.RuntimeHandoff) map[string]any {
	if handoff == nil || len(handoff.Payload) == 0 || hasForbiddenWorkflowTraceKey(handoff.Payload) {
		return map[string]any{}
	}
	payload := handoff.Payload
	switch handoff.PayloadKind {
	case "rag_request":
		return workflowRagPayloadSummary(payload)
	case "transport_schedule_lookup":
		return workflowTransportPayloadSummary(payload)
	case "service_status_lookup":
		return workflowServiceStatusPayloadSummary(payload)
	case "service_guide_lookup":
		return workflowServiceGuidePayloadSummary(payload)
	case "contact_directory_lookup":
		return workflowContactDirectoryPayloadSummary(payload)
	case "campus_notice_discover":
		return workflowNoticeDiscoverPayloadSummary(payload)
	case "campus_notice_get":
		return workflowNoticeGetPayloadSummary(payload)
	default:
		return map[string]any{}
	}
}

func workflowRagPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	if scope, ok := payload["scope"].(map[string]any); ok {
		copyStringField(summary, scope, "corpus")
		copyStringField(summary, scope, "collection")
	}
	if versionQuery, ok := payload["version_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, versionQuery, "mode", "version_query_mode")
		copyPrefixedStringField(summary, versionQuery, "as_of", "version_query_as_of")
		copyPrefixedStringField(summary, versionQuery, "version_id", "version_query_version_id")
		copyPrefixedStringField(
			summary,
			versionQuery,
			"compare_to_version_id",
			"version_query_compare_to_version_id",
		)
	}
	return summary
}

func workflowTransportPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "intent")
	copyStringField(summary, payload, "campus_scope")
	if snapshotQuery, ok := payload["snapshot_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, snapshotQuery, "mode", "snapshot_query_mode")
		copyPrefixedStringField(summary, snapshotQuery, "year_hint", "snapshot_query_year_hint")
		copyPrefixedStringField(summary, snapshotQuery, "as_of", "snapshot_query_as_of")
	}
	if serviceTimeQuery, ok := payload["service_time_query"].(map[string]any); ok {
		serviceTimeSummary := stringFields(
			serviceTimeQuery,
			"date_mode",
			"daypart",
			"time_anchor",
		)
		if len(serviceTimeSummary) > 0 {
			summary["service_time_query"] = serviceTimeSummary
		}
	}
	if routeSelector, ok := payload["route_selector"].(map[string]any); ok {
		routeSelectorSummary := stringFields(
			routeSelector,
			"route_id",
			"service_family",
			"origin_campus",
			"destination_campus",
		)
		if len(routeSelectorSummary) > 0 {
			summary["route_selector"] = routeSelectorSummary
		}
	}
	return summary
}

func workflowServiceStatusPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "campus_scope")
	if temporalQuery, ok := payload["temporal_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, temporalQuery, "mode", "temporal_query_mode")
		copyPrefixedStringField(summary, temporalQuery, "year_hint", "temporal_query_year_hint")
		copyPrefixedStringField(summary, temporalQuery, "as_of", "temporal_query_as_of")
	}
	return summary
}

func workflowServiceGuidePayloadSummary(payload map[string]any) map[string]any {
	summary := workflowServiceStatusPayloadSummary(payload)
	copyStringField(summary, payload, "guide_focus")
	copyStringField(summary, payload, "audience")
	return summary
}

func workflowContactDirectoryPayloadSummary(payload map[string]any) map[string]any {
	summary := workflowServiceStatusPayloadSummary(payload)
	copyStringField(summary, payload, "contact_focus")
	copyStringField(summary, payload, "audience")
	return summary
}

func workflowNoticeDiscoverPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	if temporalQuery, ok := payload["temporal_query"].(map[string]any); ok {
		copyPrefixedStringField(summary, temporalQuery, "mode", "temporal_query_mode")
		copyPrefixedStringField(summary, temporalQuery, "year_hint", "temporal_query_year_hint")
		copyPrefixedStringField(summary, temporalQuery, "as_of", "temporal_query_as_of")
	}
	return summary
}

func workflowNoticeGetPayloadSummary(payload map[string]any) map[string]any {
	summary := map[string]any{}
	copyStringField(summary, payload, "notice_id")
	copyStringField(summary, payload, "source_family")
	return summary
}

func copyStringField(summary map[string]any, payload map[string]any, key string) {
	copyPrefixedStringField(summary, payload, key, key)
}

func copyPrefixedStringField(
	summary map[string]any,
	payload map[string]any,
	sourceKey string,
	summaryKey string,
) {
	if value := stringValue(payload[sourceKey]); value != "" {
		summary[summaryKey] = value
	}
}

func stringFields(payload map[string]any, keys ...string) map[string]any {
	summary := map[string]any{}
	for _, key := range keys {
		copyStringField(summary, payload, key)
	}
	return summary
}

func workflowSourceIDs(result map[string]any) []string {
	ids := []string{}
	collectWorkflowSourceIDs(result, &ids)
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
				for _, sourceID := range stringArrayValue(item) {
					appendWorkflowSourceID(ids, sourceID)
				}
			}
			collectWorkflowSourceIDs(item, ids)
		}
	case []any:
		for _, item := range current {
			collectWorkflowSourceIDs(item, ids)
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
