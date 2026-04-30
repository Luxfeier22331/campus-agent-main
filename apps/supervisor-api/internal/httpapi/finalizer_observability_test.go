package httpapi

import "testing"

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
