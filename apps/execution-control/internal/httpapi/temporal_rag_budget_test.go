package httpapi

import (
	"fmt"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestRAGPlanProjectionRejectsTopKAboveBudget(t *testing.T) {
	_, err := ragPlanProjectionForRun(
		execution.DurableRun{
			RequestID: "req-rag-budget",
			RunID:     "run-rag-budget",
			Metadata: map[string]any{
				"execution_payload": map[string]any{
					"requested_scope": map[string]any{
						"collection": "student_rules",
						"corpus":     "regulations",
					},
					"top_k":     9,
					"user_goal": "学生请假流程",
				},
			},
		},
		"",
		8,
	)
	if err == nil {
		t.Fatal("top_k above configured budget must fail closed")
	}
	if !strings.Contains(err.Error(), "rag top_k 9 exceeds configured max 8") {
		t.Fatalf("error = %v, want top_k budget diagnostic", err)
	}
}

func TestSelectRAGEvidenceUsesConfiguredBudget(t *testing.T) {
	candidates := make([]ragruntime.EvidenceRef, 0, 6)
	for index := 0; index < 6; index++ {
		candidates = append(candidates, ragruntime.EvidenceRef{
			Anchor:          fmt.Sprintf("leave_procedure_%d", index),
			ChunkID:         fmt.Sprintf("chunk-%d", index),
			DocumentID:      "student_rules",
			Excerpt:         "学生应按学校规定办理手续。",
			IsAnswerBearing: true,
			RootUnitID:      fmt.Sprintf("student_rules.leave_procedure.%d", index),
			SourceID:        "student_rules",
			SourceRef:       "source://student_rules",
			SpanRef:         fmt.Sprintf("span://student_rules/chunk-%d", index),
			Title:           "学生手册",
			VersionID:       "student_rules.v1",
		})
	}
	selection, err := selectRAGEvidence(
		execution.DurableRun{RunID: "run-rag-selection-budget"},
		ragruntime.RetrievalLookupResult{
			CandidateCount: len(candidates),
			Candidates:     candidates,
			Request: ragruntime.RetrievalLookupRequest{
				RunID: "run-rag-selection-budget",
			},
			SchemaVersion: "retrieval_lookup_result_v1",
		},
		3,
	)
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}
	if len(selection.SelectedEvidence) != 3 || selection.SupportingEvidenceCount != 3 {
		t.Fatalf("selected evidence count = %d/%d, want 3", len(selection.SelectedEvidence), selection.SupportingEvidenceCount)
	}
}
