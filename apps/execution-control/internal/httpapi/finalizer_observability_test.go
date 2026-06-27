package httpapi

import "testing"

func TestBuildStructuredExecutionObservabilitySummarizesTransportScheduleTraceRefs(t *testing.T) {
	observability := buildStructuredExecutionObservability(
		"transport_schedule_lookup",
		"completed",
		map[string]any{
			"subject_query":        "丰台校区通勤班车在哪里上车",
			"outcome":              "resolved_current",
			"related_notice_refs":  []any{"authenticated_notice:355122"},
			"override_source_refs": []any{"notice:muc_internal_portal:353903"},
		},
		"transport_schedule_lookup",
	)

	if observability["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("selected_tool = %v, want transport_schedule_lookup", observability["selected_tool"])
	}
	if observability["tool_business_outcome"] != "resolved_current" {
		t.Fatalf("tool_business_outcome = %v, want resolved_current", observability["tool_business_outcome"])
	}
	if observability["notice_source_family_summary"] != "internal_notice_restricted" {
		t.Fatalf(
			"notice_source_family_summary = %v, want internal_notice_restricted",
			observability["notice_source_family_summary"],
		)
	}
	if observability["temporal_posture"] != "current" {
		t.Fatalf("temporal_posture = %v, want current", observability["temporal_posture"])
	}
}

func TestBuildStructuredExecutionObservabilityDoesNotInferSelectedToolFromResultShape(t *testing.T) {
	observability := buildStructuredExecutionObservability(
		"transport_schedule_lookup",
		"completed",
		map[string]any{
			"subject_query": "丰台校区通勤班车在哪里上车",
			"outcome":       "resolved_current",
		},
		"",
	)

	if observability["selected_tool"] != "" {
		t.Fatalf("selected_tool = %v, want empty", observability["selected_tool"])
	}
	if observability["candidate_count"] != 0 {
		t.Fatalf("candidate_count = %v, want 0 without explicit selected tool", observability["candidate_count"])
	}
}

func TestBuildStructuredExecutionObservabilitySummarizesTransportScheduleFailClose(t *testing.T) {
	observability := buildStructuredExecutionObservability(
		"transport_schedule_lookup",
		"no_answer",
		map[string]any{
			"subject_query":       "图书馆今天开门吗",
			"outcome":             "temporarily_unverifiable",
			"fail_close_reason":   "source_conflict",
			"related_notice_refs": []any{"authenticated_notice:355999"},
		},
		"",
	)

	if observability["fail_closed"] != true {
		t.Fatalf("fail_closed = %v, want true", observability["fail_closed"])
	}
	if observability["tool_fail_close_reason"] != "source_conflict" {
		t.Fatalf("tool_fail_close_reason = %v, want source_conflict", observability["tool_fail_close_reason"])
	}
	if observability["semantic_outcome"] != "temporarily_unverifiable" {
		t.Fatalf("semantic_outcome = %v, want temporarily_unverifiable", observability["semantic_outcome"])
	}
	if observability["notice_source_family_summary"] != "internal_notice_restricted" {
		t.Fatalf(
			"notice_source_family_summary = %v, want internal_notice_restricted",
			observability["notice_source_family_summary"],
		)
	}
}

func TestBuildRagExecutionObservabilitySeparatesRuntimeErrorFromEvidenceUnsupported(t *testing.T) {
	observability := buildRagExecutionObservability(
		"error",
		map[string]any{
			"evidence": map[string]any{
				"sources": []any{
					map[string]any{"doc_id": "handbook:test-001"},
				},
			},
			"diagnostics": map[string]any{
				"retrieved_sources": []any{
					map[string]any{"doc_id": "handbook:test-001"},
				},
				"semantic_outcome":      "runtime_error",
				"fail_close_reason":     "rag_sdk_runtime_failed",
				"model_execution_state": "rag_sdk_runtime_failed",
			},
		},
		"knowledge_query",
	)

	if observability["semantic_outcome"] != "runtime_error" {
		t.Fatalf("semantic_outcome = %v, want runtime_error", observability["semantic_outcome"])
	}
	if observability["retrieval_attempted"] != true {
		t.Fatalf("retrieval_attempted = %v, want true", observability["retrieval_attempted"])
	}
	if observability["fail_closed"] != true {
		t.Fatalf("fail_closed = %v, want true", observability["fail_closed"])
	}
	if observability["fail_close_reason"] != "rag_sdk_runtime_failed" {
		t.Fatalf("fail_close_reason = %v, want rag_sdk_runtime_failed", observability["fail_close_reason"])
	}
}
