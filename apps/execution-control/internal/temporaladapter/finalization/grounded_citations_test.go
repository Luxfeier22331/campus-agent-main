package finalization

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestGroundedSolvePreservesProseAndMultipleSources(t *testing.T) {
	answer := "😀海淀校区地址。"
	output := temporalruntime.WorkflowOperationActivityOutput{
		Operation: temporalruntime.WorkflowOperationSolve, FinalOutput: answer,
		WebEvidence: []temporalruntime.WebEvidence{
			{Title: "学校", URL: "https://www.muc.edu.cn/", Excerpt: "海淀校区地址。", StartIndex: 1, EndIndex: 8},
			{Title: "校区", URL: "https://www.muc.edu.cn/campus", Excerpt: "校区地址。", StartIndex: 3, EndIndex: 8},
		},
	}
	payload := WorkflowFinalizationResultMap(temporalruntime.WriteWorkflowFinalizationActivityInput{WorkflowResult: output})
	adapter := &Adapter{}
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
