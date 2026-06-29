package httpapi

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestRagasEvalProjectionEventCarriesSafeRagasFields(t *testing.T) {
	run := execution.DurableRun{
		ConversationID: "conv-ragas-eval",
		OwnerUserID:    "user-ragas-eval",
		RequestID:      "req-ragas-eval",
		RunID:          "run-ragas-eval",
		SelectedTool:   "knowledge_query",
		TraceID:        "trace-ragas-eval",
		Metadata: map[string]any{
			"temporal_rag": map[string]any{
				"plan": ragruntime.PlanProjection{
					Collection: "student_rules",
					Corpus:     "regulations",
					PlanID:     "rag:regulations:student_rules:current",
					QueryMode:  "current",
					QueryText:  "学生请假手续是什么？",
				},
				"evidence_selection": ragruntime.EvidenceSelectionResult{
					CandidateCount: 1,
					SelectedEvidence: []ragruntime.EvidenceRef{{
						ChunkID:   "chunk-leave-001",
						Excerpt:   "学生请假应按规定提交申请。",
						SourceID:  "student_rules",
						SourceRef: "source://regulations/student_rules/leave",
						SpanRef:   "span://student_rules/chunk-leave-001",
					}},
				},
			},
		},
	}

	event, err := ragasEvalProjectionEvent(run, map[string]any{
		"answer_text": "学生应按学校规定办理请假手续。",
	})
	if err != nil {
		t.Fatalf("build ragas eval projection event: %v", err)
	}

	if event.Name != "eval.ragas_projection" {
		t.Fatalf("name = %q", event.Name)
	}
	if event.EvalQuestion != "学生请假手续是什么？" {
		t.Fatalf("eval question = %q", event.EvalQuestion)
	}
	if event.EvalAnswer != "学生应按学校规定办理请假手续。" {
		t.Fatalf("eval answer = %q", event.EvalAnswer)
	}
	if len(event.EvalRetrievedContexts) != 1 ||
		event.EvalRetrievedContexts[0] != "学生请假应按规定提交申请。" {
		t.Fatalf("retrieved contexts = %#v", event.EvalRetrievedContexts)
	}
	if len(event.EvalRetrievedContextIDs) != 1 ||
		event.EvalRetrievedContextIDs[0] != "source://regulations/student_rules/leave" {
		t.Fatalf("retrieved context ids = %#v", event.EvalRetrievedContextIDs)
	}
	if event.EvalSurfaceKey != "execution-control.rag" ||
		event.EvalVariantID != "go-rag-temporal" {
		t.Fatalf("eval surface/variant = %q/%q", event.EvalSurfaceKey, event.EvalVariantID)
	}
	if event.QuerySHA256 == "" || event.QuerySHA256 == event.EvalQuestion {
		t.Fatalf("query hash = %q, want hash only", event.QuerySHA256)
	}
}
