package finalization

import (
	"reflect"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestCampusSearchRepeatedResultsFinalize(t *testing.T) {
	for _, kind := range []string{"notice", "document"} {
		t.Run(kind, func(t *testing.T) {
			first := citationSearchItem(kind, "a")
			other := citationSearchItem(kind, "b")
			// Keep the same document/notice URL: only result_ref determines merging.
			agentResult := map[string]any{"tool_results": []map[string]any{
				citationToolResult([]campusdocs.SearchResultItem{first, other}, 1),
				citationToolResult([]campusdocs.SearchResultItem{first}, 5),
			}}
			for _, tc := range []struct {
				name, answer, linked string
				refs                 []string
			}{
				{"first", "答案 [1]", "答案 [1](%s)", []string{first.ResultRef}},
				{"second", "答案 [5]", "答案 [1](%s)", []string{first.ResultRef}},
				{"both", "答案 [5]，补充 [1]", "答案 [1](%s)，补充 [1](%s)", []string{first.ResultRef}},
				{"unused", "答案", "答案", []string{}},
				{"other only", "答案 [2]", "答案 [1](%s)", []string{other.ResultRef}},
				{"mixed", "答案 [2]、[5]、[1]", "答案 [1](%s)、[2](%s)、[2](%s)", []string{other.ResultRef, first.ResultRef}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					closure, err := (&Adapter{}).WorkflowCitationClosureForFinalization(agentResult, tc.answer)
					if err != nil {
						t.Fatal(err)
					}
					href := WorkflowRunResultFromCampusSearch(first).Source["citation_href"].(string)
					if want := strings.ReplaceAll(tc.linked, "%s", href); closure.AnswerText != want {
						t.Fatalf("answer = %q, want %q", closure.AnswerText, want)
					}
					if len(closure.Sources) != len(tc.refs) {
						t.Fatalf("sources = %#v", closure.Sources)
					}
					response := map[string]any{"result": map[string]any{"sources": closure.Sources}}
					// Runtime retained index 1, but the answer may only cite index 5.
					refs := campusSearchCitedRefs(response, temporalruntime.WorkflowOperationActivityOutput{
						Operation: temporalruntime.WorkflowOperationSolve, FinalOutput: tc.answer,
						Evidence: []temporalruntime.WorkflowEvidence{{ID: "campus:" + first.ResultRef, ResultRef: first.ResultRef, Source: temporalruntime.WorkflowSourceCampusSearch, CitationIndex: 1}},
					})
					if !reflect.DeepEqual(refs, tc.refs) {
						t.Fatalf("refs = %v, want %v", refs, tc.refs)
					}
				})
			}
		})
	}
}

func TestCampusSearchCitationValidationRemainsStrict(t *testing.T) {
	item := citationSearchItem("notice", "a")
	other := citationSearchItem("notice", "b")
	invalid := item
	invalid.CitationHref = "/notices/other"
	for _, tc := range []struct {
		name, answer, errorText string
		calls                   []map[string]any
	}{
		{"within call", "[1]", "result_ref is duplicated within one call", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item, item}, 1)}},
		{"across call index", "[1]", "citation_index 1 is duplicated", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item}, 1), citationToolResult([]campusdocs.SearchResultItem{other}, 1)}},
		{"unknown", "[2]", "引用编号没有对应证据", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item}, 1)}},
		{"zero", "[0]", "引用标记非法", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item}, 1)}},
		{"out of range", "[11]", "引用编号没有对应证据", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item}, 1)}},
		{"invalid result index", "[11]", "result fields are invalid", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{item}, 11)}},
		{"source identity", "[1]", "notice result fields are invalid", []map[string]any{citationToolResult([]campusdocs.SearchResultItem{invalid}, 1)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (&Adapter{}).WorkflowCitationClosureForFinalization(map[string]any{"tool_results": tc.calls}, tc.answer)
			if err == nil || !strings.Contains(err.Error(), tc.errorText) {
				t.Fatalf("error = %v, want %q", err, tc.errorText)
			}
		})
	}
}

func TestCampusSearchCitedRefsFromSynthesizedSources(t *testing.T) {
	result := temporalruntime.WorkflowOperationActivityOutput{
		Operation: temporalruntime.WorkflowOperationSynthesize,
		Evidence: []temporalruntime.WorkflowEvidence{
			{ID: "campus:cited", ResultRef: "result://cited", Source: temporalruntime.WorkflowSourceCampusSearch},
			{ID: "unused", ResultRef: "result://unused", Source: temporalruntime.WorkflowSourceCampusSearch},
			{ID: "legacy", Source: temporalruntime.WorkflowSourceCampusSearch},
		},
	}
	response := map[string]any{"result": map[string]any{"sources": []any{
		map[string]any{"kind": "campus_notice", "evidence_ref": "campus:cited"},
		map[string]any{"kind": "campus_notice", "evidence_ref": "campus:cited"},
		map[string]any{"kind": "web_page", "evidence_ref": "web"},
		map[string]any{"kind": "campus_document", "evidence_ref": "legacy"},
	}}}
	if refs := campusSearchCitedRefs(response, result); !reflect.DeepEqual(refs, []string{"result://cited", "legacy"}) {
		t.Fatalf("refs = %v", refs)
	}
}

func citationSearchItem(kind, hash string) campusdocs.SearchResultItem {
	return campusdocs.SearchResultItem{
		SourceKind: kind, ResultRef: "result://" + strings.Repeat(hash, 64),
		Title: "校园资料", Text: "申请要求", SectionTitle: "申请",
		NoticeID: "12345", CitationHref: "/notices/12345",
		DocumentID: "handbook:student-rules", VersionID: "version-2026", VersionSlug: "2026",
		SectionRef: "/docs/regulations/student_rules/attendance/v/2026#attendance", RootUnitIDs: []string{"unit-attendance"},
	}
}

func citationToolResult(items []campusdocs.SearchResultItem, start int) map[string]any {
	return map[string]any{"tool_name": "campus_search", "status": "completed", "result": campusdocs.EncodeSearchResult(items, start)}
}
