package finalization

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

func TestGroundedSolvePreservesProseAndMultipleSources(t *testing.T) {
	answer := "😀海淀校区地址。"
	output := executioncontract.OperationOutput{
		Operation: executioncontract.WorkflowOperationSolve, FinalOutput: answer,
		WebEvidence: []executioncontract.WebEvidence{
			{Title: "学校", URL: "https://www.muc.edu.cn/", Excerpt: "海淀校区地址。", StartIndex: 1, EndIndex: 8},
			{Title: "校区", URL: "https://www.muc.edu.cn/campus", Excerpt: "校区地址。", StartIndex: 3, EndIndex: 8},
		},
	}
	payload := WorkflowFinalizationResultMap(executioncontract.FinalizationInput{WorkflowResult: output})
	adapter := &FinalizationService{}
	closure, err := adapter.WorkflowCitationClosureForFinalization(payload, answer)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(closure.AnswerText, answer) || len(closure.Sources) != 2 {
		t.Fatalf("grounding lost prose/sources: %#v", closure)
	}
	if closure.Sources[0]["kind"] != "web_page" {
		t.Fatal(closure.Sources)
	}
	output.WebEvidence[0].Excerpt = "捏造的文本"
	_, err = WorkflowGroundedCitations(map[string]any{"web_evidence": output.WebEvidence}, answer)
	if err == nil {
		t.Fatal("invalid internal citation accepted")
	}
}

func TestResolvedSourceLinksPreserveGroundingAndUnavailableNumbers(t *testing.T) {
	original := "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a"
	direct := "https://www.muc.edu.cn/ggfw/cjwt/mdgk.htm?q=1#address"
	answer := "😀海淀校区地址。"
	output := executioncontract.OperationOutput{
		Operation: executioncontract.WorkflowOperationSolve, FinalOutput: answer,
		WebEvidence: []executioncontract.WebEvidence{
			{Title: "民大概况", URL: original, SourceLink: &executioncontract.SourceLink{Href: &direct}, Excerpt: "海淀校区地址。", StartIndex: 1, EndIndex: 8},
			{Title: "另一个来源", URL: original + "b", SourceLink: &executioncontract.SourceLink{}, Excerpt: "海淀校区地址。", StartIndex: 1, EndIndex: 8},
		},
	}
	payload := WorkflowFinalizationResultMap(executioncontract.FinalizationInput{WorkflowResult: output})
	closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, answer)
	if err != nil {
		t.Fatal(err)
	}
	if closure.AnswerText != answer+"[1]("+direct+")[2]" {
		t.Fatalf("answer = %s", closure.AnswerText)
	}
	if len(closure.Sources) != 2 || closure.Sources[0]["title"] != "民大概况" || closure.Sources[0]["url"] != direct || closure.Sources[0]["hostname"] != "www.muc.edu.cn" {
		t.Fatal(closure.Sources)
	}
	if closure.Sources[1]["citation_href"] != nil || closure.Sources[1]["url"] != nil || closure.Sources[1]["unavailable_reason"] != "source_unavailable" {
		t.Fatal(closure.Sources[1])
	}
}

func TestSynthesisPreservesOriginalEvidenceIdentityWhenLinksConverge(t *testing.T) {
	original := "https://vertexaisearch.cloud.google.com/grounding-api-redirect/"
	direct := "https://www.muc.edu.cn/ggfw/cjwt/mdgk.htm"
	for _, terminal := range []string{"operation_completed", "recovered_from_materials"} {
		t.Run(terminal, func(t *testing.T) {
			output := executioncontract.OperationOutput{
				Operation: executioncontract.WorkflowOperationSynthesize, FinalOutput: "地址[1,2,3]。", TerminalReason: terminal,
				Evidence: []executioncontract.WorkflowEvidence{
					{SchemaVersion: "workflow_evidence.v1", ID: "web:" + original + "a", Source: executioncontract.WorkflowSourceWebSearch, Title: "民大概况", Excerpt: "地址", CitationIndex: 1, URL: original + "a", SourceLink: &executioncontract.SourceLink{Href: &direct}},
					{SchemaVersion: "workflow_evidence.v1", ID: "web:" + original + "b", Source: executioncontract.WorkflowSourceWebSearch, Title: "民大概况", Excerpt: "地址", CitationIndex: 2, URL: original + "b", SourceLink: &executioncontract.SourceLink{Href: &direct}},
					{SchemaVersion: "workflow_evidence.v1", ID: "web:" + original + "c", Source: executioncontract.WorkflowSourceWebSearch, Title: "不可用来源", Excerpt: "地址", CitationIndex: 3, URL: original + "c", SourceLink: &executioncontract.SourceLink{}},
				},
			}
			payload := WorkflowFinalizationResultMap(executioncontract.FinalizationInput{WorkflowResult: output})
			closure, err := (&FinalizationService{}).WorkflowCitationClosureForFinalization(payload, output.FinalOutput)
			if err != nil {
				t.Fatal(err)
			}
			if closure.AnswerText != "地址[1]("+direct+")[2]("+direct+")[3]。" || len(closure.Sources) != 3 {
				t.Fatalf("closure = %#v", closure)
			}
		})
	}
}
