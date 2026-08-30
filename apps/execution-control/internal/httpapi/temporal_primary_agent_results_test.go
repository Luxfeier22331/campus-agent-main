package httpapi

import (
	"strings"
	"testing"
)

func TestPrimaryAgentCitationClosureProjectsCitedSuccessfulResults(t *testing.T) {
	first := validCampusSearchResultForTest(1, "a")
	second := validCampusSearchResultForTest(2, "b")
	second.SectionRef += "-second"
	agentResult := map[string]any{
		"tool_results": []map[string]any{
			{
				"result":    campusSearchResult([]campusSearchResultItem{first, second}, 1),
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

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(
		agentResult,
		"第二条规定优先适用 [2]，第一条也提供背景 [1]。重复引用 [2]。",
	)
	if err != nil {
		t.Fatalf("close valid citations: %v", err)
	}
	if len(closure.Sources) != 2 ||
		closure.Sources[0]["citation_index"] != 2 ||
		closure.Sources[0]["result_ref"] != second.ResultRef ||
		closure.Sources[1]["citation_index"] != 1 ||
		closure.Sources[1]["result_ref"] != first.ResultRef {
		t.Fatalf("closed sources = %#v", closure.Sources)
	}
}

func TestPrimaryAgentCitationClosureUsesExplicitIndexesAcrossCalls(t *testing.T) {
	first := validCampusSearchResultForTest(1, "a")
	second := validCampusSearchResultForTest(4, "b")
	agentResult := map[string]any{
		"tool_results": []map[string]any{
			{"result": campusSearchResult([]campusSearchResultItem{first}, 1), "status": "completed", "tool_name": campusSearchToolName},
			{"result": campusSearchResult([]campusSearchResultItem{second}, 4), "status": "completed", "tool_name": campusSearchToolName},
		},
	}

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, "采用后续结果 [4]。")
	if err != nil || len(closure.Sources) != 1 || closure.Sources[0]["result_ref"] != second.ResultRef {
		t.Fatalf("explicit citation closure = %#v, err = %v", closure.Sources, err)
	}
}

func TestPrimaryAgentCitationClosureRejectsUnknownAndOutOfRangeCitations(t *testing.T) {
	item := validCampusSearchResultForTest(1, "a")
	agentResult := map[string]any{"tool_results": []map[string]any{{
		"result": campusSearchResult([]campusSearchResultItem{item}, 1), "status": "completed", "tool_name": campusSearchToolName,
	}}}
	for _, answer := range []string{"未知编号 [2]", "越界编号 [11]", "零编号 [0]"} {
		if _, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, answer); err == nil {
			t.Fatalf("accepted invalid answer %q", answer)
		}
	}
}

func TestPrimaryAgentCitationClosureAcceptsCitationTen(t *testing.T) {
	item := validCampusSearchResultForTest(10, "a")
	agentResult := map[string]any{"tool_results": []map[string]any{{
		"result": campusSearchResult([]campusSearchResultItem{item}, 10), "status": "completed", "tool_name": campusSearchToolName,
	}}}

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, "采用检索结果 [10]。")
	if err != nil || len(closure.Sources) != 1 || closure.Sources[0]["citation_index"] != 10 {
		t.Fatalf("citation ten closure = %#v, err = %v", closure.Sources, err)
	}
}

func TestPrimaryAgentCitationClosureIgnoresFailedToolResults(t *testing.T) {
	item := validCampusSearchResultForTest(1, "a")
	agentResult := map[string]any{"tool_results": []map[string]any{{
		"result": campusSearchResult([]campusSearchResultItem{item}, 1), "status": "failed", "tool_name": campusSearchToolName,
	}}}

	if _, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, "请按规定提交材料 [1]。"); err == nil {
		t.Fatal("citation to failed tool result was accepted")
	}
}

func validCampusSearchResultForTest(citationIndex int, hashCharacter string) campusSearchResultItem {
	return campusSearchResultItem{
		CitationIndex: citationIndex,
		ResultRef:     "result://" + strings.Repeat(hashCharacter, 64),
		SourceKind:    "document",
		DocumentID:    "student-rules",
		Title:         "学生管理规定",
		SectionRef:    "/docs/regulations/student_rules/attendance/v/2026-current#attendance",
		SectionTitle:  "材料提交",
		RootUnitIDs:   []string{"attendance"},
		VersionID:     "student-rules-2026",
		VersionLabel:  "2026",
		VersionSlug:   "2026-current",
		Text:          "学生应当在规定期限内提交材料。",
	}
}
