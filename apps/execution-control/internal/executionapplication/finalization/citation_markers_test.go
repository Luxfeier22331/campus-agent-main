package finalization

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

func TestGroupedCitationClosure(t *testing.T) {
	first, second := citationSearchItem("notice", "a"), citationSearchItem("notice", "b")
	payload := map[string]any{"tool_results": []map[string]any{
		citationToolResult([]campussearch.SearchResultItem{first}, 1),
		citationToolResult([]campussearch.SearchResultItem{second}, 5),
	}}
	for _, answer := range []string{"答案[5,1,5]", "答案[5, 1, 5]"} {
		closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, answer)
		if err != nil {
			t.Fatal(err)
		}
		if closure.AnswerText != "答案[1](/notices/12345)[2](/notices/12345)" || len(closure.Sources) != 2 || closure.Sources[0]["evidence_ref"] != second.ResultRef {
			t.Fatalf("%#v", closure)
		}
	}
	for _, answer := range []string{"[1, 8]", "[0, 1]", "[99999999999999999999999999]"} {
		if _, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, answer); err == nil {
			t.Fatalf("accepted %s", answer)
		}
	}
	evidence := []executioncontract.WorkflowEvidence{
		{ID: "web-one", Source: executioncontract.WorkflowSourceWebSearch, Title: "学校", Excerpt: "资料", URL: "https://muc.edu.cn/one", CitationIndex: 1},
		{ID: "web-five", Source: executioncontract.WorkflowSourceWebSearch, Title: "学校", Excerpt: "资料", URL: "https://muc.edu.cn/five", CitationIndex: 5},
	}
	closure, err := WorkflowEvidenceCitationClosureForFinalization(evidence, "答案[5, 1, 5]")
	if err != nil {
		t.Fatal(err)
	}
	if closure.AnswerText != "答案[5](https://muc.edu.cn/five)[1](https://muc.edu.cn/one)" || len(closure.Sources) != 2 {
		t.Fatalf("%#v", closure)
	}
	if _, err := WorkflowEvidenceCitationClosureForFinalization(evidence, "[1, 8]"); err == nil {
		t.Fatal("accepted unknown synthesis index")
	}
}

func TestCitationMarkdownLiterals(t *testing.T) {
	answer := "`[9]`\n```go\n[8, 9]\n```\n~~~\n[7]\n~~~\n\\[6] [5](https://example.com) [学校](https://example.com) [4][ref]\n\n[ref]: https://example.com"
	for _, operation := range []string{"solve", "synthesize"} {
		closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(map[string]any{"operation": operation}, answer)
		if err != nil || closure.AnswerText != answer || len(closure.Sources) != 0 {
			t.Fatalf("%s: %#v %v", operation, closure, err)
		}
	}
}

func TestGroundedRawMarkers(t *testing.T) {
	prose := "😀开放时间以通知为准。"
	for _, tc := range []struct {
		name, answer, excerpt string
		start                 int
		fail                  bool
	}{
		{"single", prose + "[1]", prose, 0, false},
		{"group", prose + "[1, 5]", prose, 0, false},
		{"inside", prose + "[1, 5]", prose + "[1,", 0, false},
		{"tail", prose + "[1, 5]", prose + "[1, 5]", 0, false},
		{"whitespace", prose + " \n[5]", prose, 0, false},
		{"paragraph", prose + "\n \n[5]", prose, 0, true},
		{"unrelated", prose + "另一个事实[5]", prose, 0, true},
		{"before", "[5]" + prose, prose, 3, true},
		{"mismatch", prose + "[5]", "错误正文", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			evidence := []executioncontract.WebEvidence{{Title: "学校", URL: "https://muc.edu.cn/", Excerpt: tc.excerpt, StartIndex: tc.start, EndIndex: tc.start + utf8.RuneCountInString(tc.excerpt)}}
			payload := WorkflowFinalizationResultMap(executioncontract.FinalizationInput{WorkflowResult: executioncontract.OperationOutput{Operation: executioncontract.WorkflowOperationSolve, FinalOutput: tc.answer, WebEvidence: evidence}})
			closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, tc.answer)
			if tc.fail {
				if err == nil {
					t.Fatal("accepted unsupported marker")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(closure.Sources) != 1 || !strings.Contains(closure.AnswerText, "[1](https://muc.edu.cn/)") || strings.Contains(closure.AnswerText, "[1, 5]") {
				t.Fatalf("%#v", closure)
			}
		})
	}
}

func TestGroundedMixedCampusGroup(t *testing.T) {
	answer := "😀学校[1, 5]"
	payload := map[string]any{
		"tool_results": []map[string]any{citationToolResult([]campussearch.SearchResultItem{citationSearchItem("notice", "a")}, 1)},
		"web_evidence": []executioncontract.WebEvidence{
			{Title: "学校", URL: "https://muc.edu.cn/", Excerpt: "😀学校[1,", StartIndex: 0, EndIndex: 6},
			{Title: "校区", URL: "https://muc.edu.cn/campus", Excerpt: "学校[1, 5]", StartIndex: 1, EndIndex: 9},
		},
	}
	closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, answer)
	if err != nil {
		t.Fatal(err)
	}
	if closure.AnswerText != "😀学校[1](/notices/12345)[2](https://muc.edu.cn/)[3](https://muc.edu.cn/campus)" || len(closure.Sources) != 3 {
		t.Fatalf("%#v", closure)
	}
}

func TestCitationNestedMarkdownLiterals(t *testing.T) {
	for _, text := range []string{"````md\n```\n[8]\n```\n````", "```md\n[8]", "[示例[8]](https://example.com/a(b))", "``code ` [8]``"} {
		if markers := scanWorkflowCitationMarkers(text); len(markers) != 0 {
			t.Fatalf("literal %q: %#v", text, markers)
		}
	}
}

func TestAdjacentCitationClosure(t *testing.T) {
	indexes := []int{1, 2, 3, 5, 8}
	results := []map[string]any{}
	evidence := []executioncontract.WorkflowEvidence{}
	for _, index := range indexes {
		item := citationSearchItem("notice", fmt.Sprint(index))
		results = append(results, citationToolResult([]campussearch.SearchResultItem{item}, index))
		evidence = append(evidence, executioncontract.WorkflowEvidence{ID: fmt.Sprint(index), Source: executioncontract.WorkflowSourceWebSearch, Title: "学校", Excerpt: "资料", URL: fmt.Sprintf("https://muc.edu.cn/%d", index), CitationIndex: index})
	}
	answer := "答案[1][2][3][5]；补充[2][8]"
	solve, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(map[string]any{"tool_results": results}, answer)
	require.NoError(t, err)
	require.Len(t, solve.Sources, 5)
	require.Equal(t, "答案[1](/notices/12345)[2](/notices/12345)[3](/notices/12345)[4](/notices/12345)；补充[2](/notices/12345)[5](/notices/12345)", solve.AnswerText)
	synthesis, err := WorkflowEvidenceCitationClosureForFinalization(evidence, answer)
	require.NoError(t, err)
	require.Len(t, synthesis.Sources, 5)
	require.Equal(t, "答案[1](https://muc.edu.cn/1)[2](https://muc.edu.cn/2)[3](https://muc.edu.cn/3)[5](https://muc.edu.cn/5)；补充[2](https://muc.edu.cn/2)[8](https://muc.edu.cn/8)", synthesis.AnswerText)
}
