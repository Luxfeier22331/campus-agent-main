package httpapi

import (
	"strings"
	"testing"
)

func TestPrimaryAgentEvidenceClosureProjectsCitedSuccessfulEvidence(t *testing.T) {
	first := validCampusSearchEvidenceForTest()
	second := first
	second.EvidenceRef = "evidence://" + strings.Repeat("b", 64)
	second.SectionRef += "-second"
	agentResult := map[string]any{
		"tool_results": []map[string]any{
			{
				"result":    campusSearchResult([]campusSearchEvidence{first, second}),
				"status":    "completed",
				"tool_name": campusSearchToolName,
			},
			{
				"result":    map[string]any{"error": map[string]any{"code": "memory_unavailable"}},
				"status":    "failed",
				"tool_name": personalMemoryRecallToolName,
			},
		},
	}

	closure, err := (&Server{}).primaryAgentEvidenceClosureForFinalization(
		agentResult,
		"第二条规定优先适用 [2]，第一条也提供背景 [1]。重复引用 [2]。",
	)
	if err != nil {
		t.Fatalf("close valid evidence: %v", err)
	}
	if len(closure.Sources) != 2 {
		t.Fatalf("closed sources = %#v", closure.Sources)
	}
	if closure.Sources[0]["citation_index"] != 2 ||
		closure.Sources[0]["evidence_ref"] != second.EvidenceRef ||
		closure.Sources[1]["citation_index"] != 1 ||
		closure.Sources[1]["evidence_ref"] != first.EvidenceRef {
		t.Fatalf("closed sources = %#v", closure.Sources)
	}
}

func TestPrimaryAgentEvidenceClosureIgnoresMissingAndMalformedCitations(t *testing.T) {
	evidence := validCampusSearchEvidenceForTest()
	agentResult := map[string]any{
		"tool_results": []map[string]any{{
			"result":    campusSearchResult([]campusSearchEvidence{evidence}),
			"status":    "completed",
			"tool_name": campusSearchToolName,
		}},
	}

	closure, err := (&Server{}).primaryAgentEvidenceClosureForFinalization(
		agentResult,
		"只有 [2]、[0]、[6] 和 [abc]，正文保持不变。",
	)
	if err != nil {
		t.Fatalf("close evidence: %v", err)
	}
	if len(closure.Sources) != 0 {
		t.Fatalf("closed sources = %#v", closure.Sources)
	}
}

func TestPrimaryAgentEvidenceClosureIgnoresFailedToolEvidence(t *testing.T) {
	evidence := validCampusSearchEvidenceForTest()
	agentResult := map[string]any{
		"tool_results": []map[string]any{{
			"result":    campusSearchResult([]campusSearchEvidence{evidence}),
			"status":    "failed",
			"tool_name": campusSearchToolName,
		}},
	}

	closure, err := (&Server{}).primaryAgentEvidenceClosureForFinalization(agentResult, "请按规定提交材料 [1]。")
	if err != nil {
		t.Fatalf("close failed evidence: %v", err)
	}
	if len(closure.Sources) != 0 {
		t.Fatalf("closed sources = %#v", closure.Sources)
	}
}

func validCampusSearchEvidenceForTest() campusSearchEvidence {
	return campusSearchEvidence{
		EvidenceRef:  "evidence://" + strings.Repeat("a", 64),
		SourceKind:   "document",
		DocumentID:   "student-rules",
		Title:        "学生管理规定",
		SectionRef:   "/docs/regulations/student_rules/attendance/v/2026-current#attendance",
		SectionTitle: "材料提交",
		RootUnitIDs:  []string{"attendance"},
		VersionID:    "student-rules-2026",
		VersionLabel: "2026",
		VersionSlug:  "2026-current",
		Text:         "学生应当在规定期限内提交材料。",
	}
}
