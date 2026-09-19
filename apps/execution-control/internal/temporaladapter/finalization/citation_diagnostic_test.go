package finalization

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/citationdiagnostic"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestCitationFailureReasons(t *testing.T) {
	for _, tc := range []struct {
		name, answer, reason string
		evidence             []temporalruntime.WorkflowEvidence
	}{
		{"missing evidence", "[7]", "missing_evidence", nil},
		{"zero marker", "[0]", "invalid_marker", nil},
		{"missing field", "", "missing_field", []temporalruntime.WorkflowEvidence{{ID: "e1"}}},
		{"duplicate evidence", "", "duplicate_evidence_id", []temporalruntime.WorkflowEvidence{{ID: "e1", Title: "学校", Excerpt: "通知"}, {ID: "e1", Title: "学校", Excerpt: "通知"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := WorkflowEvidenceCitationClosureForFinalization(tc.evidence, tc.answer)
			_ = assertCitationFailure(t, err, tc.reason)
		})
	}
	for _, tc := range []struct {
		name, reason string
		patch        map[string]any
	}{
		{"title", "missing_field", map[string]any{"title": ""}},
		{"url", "invalid_url", map[string]any{"url": "bad"}},
		{"start type", "invalid_offset", map[string]any{"start_index": "wrong"}},
		{"end range", "span_out_of_bounds", map[string]any{"end_index": 9}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			citation := map[string]any{"title": "学校", "url": "https://www.muc.edu.cn/", "start_index": 0, "end_index": 2}
			for k, v := range tc.patch {
				citation[k] = v
			}
			_, err := WorkflowWebCitationsFromAgentResult(map[string]any{"web_search_used": true, "web_citations": []map[string]any{citation}}, "😀学校")
			_ = assertCitationFailure(t, err, tc.reason)
		})
	}
}
func TestGroundedCitationOffsetUnit(t *testing.T) {
	_, err := WorkflowGroundedCitations(map[string]any{"web_evidence": []map[string]any{{"url": "https://www.muc.edu.cn/", "title": "学校", "excerpt": "学校", "start_index": 1, "end_index": 5}}}, "😀学校")
	failure := assertCitationFailure(t, err, "span_out_of_bounds")
	var facts map[string]any
	if err := json.Unmarshal(failure.Citation, &facts); err != nil {
		t.Fatal(err)
	}
	if facts["text_length"] != float64(3) || facts["offset_unit"] != "unicode_code_point" {
		t.Fatalf("incorrect units: %v", facts)
	}
}
func assertCitationFailure(t *testing.T, err error, reason string) *WorkflowCitationValidationError {
	t.Helper()
	var failure *WorkflowCitationValidationError
	if !errors.As(err, &failure) || failure.Reason != reason {
		t.Fatalf("failure=%v want %s", err, reason)
	}
	if !citationdiagnostic.Valid(failure.Citation) {
		t.Fatalf("invalid facts %s", failure.Citation)
	}
	return failure
}
