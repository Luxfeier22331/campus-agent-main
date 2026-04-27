package httpapi

import "testing"

func TestFinalizeAgentBridgeResponseBuildsSupervisorEnvelope(t *testing.T) {
	response, err := finalizeAgentBridgeResponse(
		map[string]any{
			"target":      "rag-agent",
			"status":      "completed",
			"answer_text": "图书馆开放到 22:00。",
			"confidence":  "high",
			"result": map[string]any{
				"evidence": map[string]any{
					"sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
				"diagnostics": map[string]any{
					"retrieved_sources": []any{
						map[string]any{"doc_id": "handbook:test-001"},
					},
				},
			},
		},
		"trace-finalizer-1",
		"",
	)
	if err != nil {
		t.Fatalf("finalize returned error: %v", err)
	}
	if response["selected_target"] != "rag-agent" {
		t.Fatalf("selected_target = %v, want rag-agent", response["selected_target"])
	}
	if response["status"] != "completed" {
		t.Fatalf("status = %v, want completed", response["status"])
	}
	if response["trace_id"] != "trace-finalizer-1" {
		t.Fatalf("trace_id = %v, want trace-finalizer-1", response["trace_id"])
	}
	observability, ok := response["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v, want object", response["observability"])
	}
	if observability["retrieval_attempted"] != true {
		t.Fatalf("retrieval_attempted = %v, want true", observability["retrieval_attempted"])
	}
	if observability["citation_count"] != 1 {
		t.Fatalf("citation_count = %v, want 1", observability["citation_count"])
	}
	if observability["semantic_outcome"] != "grounded_answer" {
		t.Fatalf("semantic_outcome = %v, want grounded_answer", observability["semantic_outcome"])
	}
}

func TestBuildStructuredSupervisorObservabilitySummarizesServiceStatusTraceRefs(t *testing.T) {
	observability := buildStructuredSupervisorObservability(
		"campus-services-agent",
		"completed",
		map[string]any{
			"subject_query":        "丰台校区通勤班车在哪里上车",
			"outcome":              "resolved_current",
			"related_notice_refs":  []any{"authenticated_notice:355122"},
			"override_source_refs": []any{"notice:muc_internal_portal:353903"},
		},
		"",
	)

	if observability["selected_tool"] != "service_status_lookup" {
		t.Fatalf("selected_tool = %v, want service_status_lookup", observability["selected_tool"])
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

func TestBuildStructuredSupervisorObservabilitySummarizesServiceStatusFailClose(t *testing.T) {
	observability := buildStructuredSupervisorObservability(
		"campus-services-agent",
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
