package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

func TestSelectRAGEvidenceFailsClosedWithoutAnswerBearingEvidence(t *testing.T) {
	run := execution.DurableRun{RunID: "run-no-answer-bearing"}
	_, err := selectRAGEvidence(run, ragruntime.RetrievalLookupResult{
		CandidateCount: 1,
		Candidates: []ragruntime.EvidenceRef{{
			ChunkID:   "chunk-1",
			Excerpt:   "这是一段目录或标题，不是回答证据。",
			Score:     0.81,
			SourceID:  "doc-1",
			SourceRef: "source://doc-1",
			SpanRef:   "span://doc-1/chunk-1",
			Title:     "学生手册",
		}},
		SchemaVersion: "retrieval_lookup_result_v1",
	}, 8)
	if err == nil {
		t.Fatal("selection without answer-bearing evidence must fail closed")
	}
	if !strings.Contains(err.Error(), "answer-bearing") {
		t.Fatalf("error = %v, want answer-bearing diagnostic", err)
	}
}

func TestSelectRAGEvidenceKeepsOnlyAnswerBearingEvidence(t *testing.T) {
	run := execution.DurableRun{
		RunID: "run-answer-bearing",
		Metadata: map[string]any{
			"temporal_rag": map[string]any{
				"plan": ragruntime.PlanProjection{
					SourceTrustPolicy: ragruntime.SourceTrustPolicy{MinimumTier: "T2"},
				},
			},
		},
	}
	selection, err := selectRAGEvidence(run, ragruntime.RetrievalLookupResult{
		CandidateCount: 2,
		Candidates: []ragruntime.EvidenceRef{
			{
				Anchor:     "title",
				ChunkID:    "chunk-title",
				DocumentID: "doc-1",
				Excerpt:    "标题。",
				RootUnitID: "root-title",
				Score:      0.91,
				SourceID:   "doc-1",
				SourceRef:  "source://doc-1",
				SpanRef:    "span://doc-1/chunk-title",
				Title:      "学生手册",
				VersionID:  "v1",
			},
			{
				Anchor:          "leave",
				ChunkID:         "chunk-answer",
				DocumentID:      "doc-1",
				Excerpt:         "学生应当按照学校规定办理请假手续。",
				IsAnswerBearing: true,
				RootUnitID:      "root-leave",
				Score:           0.88,
				SourceID:        "doc-1",
				SourceRef:       "source://doc-1",
				SourceTrustTier: "T1",
				SpanRef:         "span://doc-1/chunk-answer",
				Title:           "学生手册",
				VersionID:       "v1",
			},
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	}, 8)
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}
	if selection.SupportingEvidenceCount != 1 || selection.SelectedEvidence[0].ChunkID != "chunk-answer" {
		t.Fatalf("selected evidence = %#v, want only answer-bearing chunk", selection.SelectedEvidence)
	}
}
