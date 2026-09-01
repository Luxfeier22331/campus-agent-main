package httpapi

import (
	"errors"
	"strings"
	"testing"
)

func TestPrimaryAgentCitationClosureRewritesCampusCitationsInFirstAppearanceOrder(t *testing.T) {
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
	wantAnswer := "第二条规定优先适用 [1](" + second.SectionRef + ")，第一条也提供背景 [2](" + first.SectionRef + ")。重复引用 [1](" + second.SectionRef + ")。"
	if closure.AnswerText != wantAnswer {
		t.Fatalf("answer with citations = %q, want %q", closure.AnswerText, wantAnswer)
	}
	if len(closure.Sources) != 2 ||
		closure.Sources[0]["citation_index"] != 1 ||
		closure.Sources[0]["evidence_ref"] != second.ResultRef ||
		closure.Sources[1]["citation_index"] != 2 ||
		closure.Sources[1]["evidence_ref"] != first.ResultRef ||
		closure.Sources[0]["citation_href"] != second.SectionRef ||
		closure.Sources[1]["citation_href"] != first.SectionRef {
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
	wantAnswer := "采用后续结果 [1](" + second.SectionRef + ")。"
	if err != nil || closure.AnswerText != wantAnswer || len(closure.Sources) != 1 ||
		closure.Sources[0]["evidence_ref"] != second.ResultRef {
		t.Fatalf("explicit citation closure = %#v, answer = %q, err = %v", closure.Sources, closure.AnswerText, err)
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
	if err != nil || closure.AnswerText != "采用检索结果 [1]("+item.SectionRef+")。" ||
		len(closure.Sources) != 1 || closure.Sources[0]["citation_index"] != 1 {
		t.Fatalf("citation ten closure = %#v, answer = %q, err = %v", closure.Sources, closure.AnswerText, err)
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

func TestPrimaryAgentCitationClosureProjectsWebCitations(t *testing.T) {
	const answer = "本校地址见这里。"
	agentResult := map[string]any{
		"web_search_used": true,
		"web_citations": []map[string]any{{
			"start_index": 5,
			"end_index":   7,
			"title":       "学校官网",
			"url":         "https://example.edu/page?campus=main#address",
		}},
	}

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, answer)
	if err != nil {
		t.Fatalf("close web evidence: %v", err)
	}
	if closure.AnswerText != "本校地址见[1](https://example.edu/page?campus=main#address)。" {
		t.Fatalf("answer with web citation = %q", closure.AnswerText)
	}
	if len(closure.Sources) != 1 ||
		closure.Sources[0]["kind"] != "web_page" ||
		closure.Sources[0]["citation_index"] != 1 ||
		closure.Sources[0]["citation_href"] != "https://example.edu/page?campus=main#address" ||
		closure.Sources[0]["hostname"] != "example.edu" {
		t.Fatalf("web source = %#v", closure.Sources)
	}
}

func TestPrimaryAgentCitationClosureMergesRepeatedWebURLIdentity(t *testing.T) {
	agentResult := map[string]any{
		"web_search_used": true,
		"web_citations": []map[string]any{
			{"start_index": 0, "end_index": 1, "title": "同一页面", "url": "https://example.edu/page?x=1"},
			{"start_index": 1, "end_index": 2, "title": "同一页面", "url": "https://example.edu/page?x=1"},
			{"start_index": 2, "end_index": 3, "title": "不同查询", "url": "https://example.edu/page?x=2"},
		},
	}

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, "甲乙丙")
	if err != nil {
		t.Fatalf("close repeated web evidence: %v", err)
	}
	if closure.AnswerText != "[1](https://example.edu/page?x=1)[1](https://example.edu/page?x=1)[2](https://example.edu/page?x=2)" {
		t.Fatalf("answer with repeated web citations = %q", closure.AnswerText)
	}
	if len(closure.Sources) != 2 || closure.Sources[1]["citation_index"] != 2 {
		t.Fatalf("web sources = %#v", closure.Sources)
	}
}

func TestPrimaryAgentCitationClosureRejectsInvalidCitations(t *testing.T) {
	item := validCampusSearchResultForTest(1, "a")
	tests := []struct {
		name        string
		agentResult map[string]any
		answer      string
	}{
		{
			name: "web search without citation",
			agentResult: map[string]any{
				"web_search_used": true,
				"web_citations":   []map[string]any{},
			},
			answer: "没有来源。",
		},
		{
			name: "web citation outside answer",
			agentResult: map[string]any{
				"web_search_used": true,
				"web_citations": []map[string]any{{
					"start_index": 0,
					"end_index":   20,
					"title":       "页面",
					"url":         "https://example.edu/page",
				}},
			},
			answer: "短文本",
		},
		{
			name: "web citation overlaps campus marker",
			agentResult: map[string]any{
				"web_search_used": true,
				"web_citations": []map[string]any{{
					"start_index": 0,
					"end_index":   3,
					"title":       "页面",
					"url":         "https://example.edu/page",
				}},
				"tool_results": []map[string]any{{
					"result": campusSearchResult([]campusSearchResultItem{item}, 1), "status": "completed", "tool_name": campusSearchToolName,
				}},
			},
			answer: "[1]。",
		},
		{
			name: "web URL with credentials",
			agentResult: map[string]any{
				"web_search_used": true,
				"web_citations": []map[string]any{{
					"start_index": 0,
					"end_index":   1,
					"title":       "页面",
					"url":         "https://user:secret@example.edu/page",
				}},
			},
			answer: "页",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := (&Server{}).primaryAgentCitationClosureForFinalization(test.agentResult, test.answer)
			if err == nil {
				t.Fatal("expected citation validation error")
			}
			var citationError *primaryAgentCitationValidationError
			if !errors.As(err, &citationError) {
				t.Fatalf("error = %T %v, want citation validation error", err, err)
			}
		})
	}
}

func TestPrimaryAgentCitationClosureRejectsCitationsFromFailedCampusSearch(t *testing.T) {
	item := validCampusSearchResultForTest(1, "a")
	agentResult := map[string]any{"tool_results": []map[string]any{{
		"result": campusSearchResult([]campusSearchResultItem{item}, 1), "status": "failed", "tool_name": campusSearchToolName,
	}}}

	_, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, "请按规定提交材料 [1]。")
	if err == nil {
		t.Fatal("expected citation validation error")
	}
	var citationError *primaryAgentCitationValidationError
	if !errors.As(err, &citationError) {
		t.Fatalf("error = %T %v, want citation validation error", err, err)
	}
}

func TestPrimaryAgentCitationClosureDiscardsNumericMarkersWithoutCampusResultsWhenWebCitationExists(t *testing.T) {
	const answer = "海淀校区地址 [1]，丰台校区地址 [1]。来源见官网。 ([muc.edu.cn](https://www.muc.edu.cn/contact))"
	agentResult := map[string]any{
		"tool_results": []map[string]any{{
			"result": campusSearchResult([]campusSearchResultItem{}, 1), "status": "completed", "tool_name": campusSearchToolName,
		}},
		"web_search_used": true,
		"web_citations": []map[string]any{{
			"start_index": 29,
			"end_index":   75,
			"title":       "学校官网",
			"url":         "https://www.muc.edu.cn/contact",
		}},
	}

	closure, err := (&Server{}).primaryAgentCitationClosureForFinalization(agentResult, answer)
	if err != nil {
		t.Fatalf("close web evidence with redundant numeric markers: %v", err)
	}
	if closure.AnswerText != "海淀校区地址，丰台校区地址。来源见官网。 [1](https://www.muc.edu.cn/contact)" {
		t.Fatalf("answer with normalized citations = %q", closure.AnswerText)
	}
	if len(closure.Sources) != 1 ||
		closure.Sources[0]["kind"] != "web_page" ||
		closure.Sources[0]["citation_index"] != 1 {
		t.Fatalf("web sources = %#v", closure.Sources)
	}
}

func validCampusSearchResultForTest(citationIndex int, hashCharacter string) campusSearchResultItem {
	return campusSearchResultItem{
		CitationIndex: citationIndex,
		ResultRef:     "result://" + strings.Repeat(hashCharacter, 64),
		SourceKind:    "document",
		DocumentID:    "student-rules",
		Title:         "学生管理规定",
		SectionRef:    "/docs/regulations/student_rules/attendance/v/2026#attendance",
		SectionTitle:  "材料提交",
		RootUnitIDs:   []string{"attendance"},
		VersionID:     "student-rules-2026",
		VersionSlug:   "2026",
		Text:          "学生应当在规定期限内提交材料。",
	}
}
