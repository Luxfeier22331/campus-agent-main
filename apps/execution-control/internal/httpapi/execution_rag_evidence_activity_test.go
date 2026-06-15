package httpapi

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
	})
	if err == nil {
		t.Fatal("selection without answer-bearing evidence must fail closed")
	}
	if !strings.Contains(err.Error(), "answer-bearing") {
		t.Fatalf("error = %v, want answer-bearing diagnostic", err)
	}
}

func TestSelectRAGEvidenceKeepsOnlyAnswerBearingEvidence(t *testing.T) {
	run := execution.DurableRun{RunID: "run-answer-bearing"}
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
				SpanRef:         "span://doc-1/chunk-answer",
				Title:           "学生手册",
				VersionID:       "v1",
			},
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	})
	if err != nil {
		t.Fatalf("select evidence: %v", err)
	}
	if selection.SupportingEvidenceCount != 1 || selection.SelectedEvidence[0].ChunkID != "chunk-answer" {
		t.Fatalf("selected evidence = %#v, want only answer-bearing chunk", selection.SelectedEvidence)
	}
}

func TestExpandOrRescueRetrievalActivityReportsAnswerBearingCoverage(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachReadyRAGVersionResolverForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.ragLookupExecutor = &fakeRAGLookupExecutor{}
	server.ragLookupErr = nil
	now := time.Date(2026, 6, 8, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-rag-rescue-covered",
		"conv-rag-rescue-covered",
		now,
		ragHandoffForDurableWorkerTest("学生请假手续"),
	)
	addRequestedScopeForRunTest(t, store, "run-rag-rescue-covered", "regulations", "student_rules")
	workflowPlan, err := server.PlanRouteActivity(
		context.Background(),
		temporalruntime.PlanRouteActivityInput{
			ConversationID: "conv-rag-rescue-covered",
			Namespace:      "campus-agent-test",
			PayloadSHA256:  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			RequestID:      "req-rag-rescue-covered",
			RunID:          "run-rag-rescue-covered",
			TraceID:        "trace-executor-001",
			TurnID:         "turn-rag-rescue-covered",
			WorkflowID:     "campus-agent.chat.run-rag-rescue-covered",
		},
	)
	if err != nil {
		t.Fatalf("plan route: %v", err)
	}
	ragPlan, err := server.PlanRAGActivity(
		context.Background(),
		temporalruntime.PlanRAGActivityInput{
			RunID:           "run-rag-rescue-covered",
			TraceID:         "trace-executor-001",
			WorkflowPlanRef: workflowPlan.PlanRef,
		},
	)
	if err != nil {
		t.Fatalf("plan rag: %v", err)
	}
	lookupOutput, err := server.RetrieveIndexedLookupActivity(
		context.Background(),
		temporalruntime.RetrieveIndexedLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-rescue-covered",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retrieve indexed lookup: %v", err)
	}
	_, err = server.ExpandOrRescueRetrievalActivity(
		context.Background(),
		temporalruntime.ExpandOrRescueRetrievalActivityInput{
			LookupRef:  lookupOutput.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      "run-rag-rescue-covered",
			TraceID:    "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("expand or rescue: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-rag-rescue-covered")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	rawTemporalRAG, _ := run.Metadata["temporal_rag"].(map[string]any)
	result, err := decodeRAGProjection[ragruntime.RetrievalRescueResult](rawTemporalRAG["rescue_result"])
	if err != nil {
		t.Fatalf("decode rescue result: %v", err)
	}
	if result.RescueApplied {
		t.Fatalf("rescue applied = true, want false when answer-bearing coverage is present")
	}
	if result.RescueReason != "answer_bearing_evidence_present" {
		t.Fatalf("rescue reason = %q, want answer_bearing_evidence_present", result.RescueReason)
	}
}

func TestRetrievalRescueDecisionFailsClosedForUnsupportedLiveAndUnresolvedAsOfBranches(t *testing.T) {
	lookup := ragruntime.RetrievalLookupResult{
		CandidateCount: 1,
		Candidates: []ragruntime.EvidenceRef{{
			Anchor:          "leave",
			ChunkID:         "chunk-1",
			DocumentID:      "doc-1",
			Excerpt:         "学生应当按照学校规定办理请假手续。",
			IsAnswerBearing: true,
			RootUnitID:      "root-leave",
			Score:           0.91,
			SourceID:        "doc-1",
			SourceRef:       "source://doc-1",
			SpanRef:         "span://doc-1/chunk-1",
			Title:           "学生手册",
			VersionID:       "v1",
		}},
		SchemaVersion: "retrieval_lookup_result_v1",
	}
	_, _, err := retrievalRescueDecision(ragruntime.PlanProjection{
		QueryMode: "live_assisted",
	}, lookup)
	if err == nil {
		t.Fatal("live_assisted rescue decision must fail closed")
	}
	_, _, err = retrievalRescueDecision(ragruntime.PlanProjection{
		QueryMode: "as_of",
	}, lookup)
	if err == nil {
		t.Fatal("unresolved as_of rescue decision must fail closed")
	}
	rescueApplied, reason, err := retrievalRescueDecision(ragruntime.PlanProjection{
		QueryMode: "as_of",
		ResolvedVersionQuery: &ragruntime.ResolvedVersionQueryProjection{
			AsOf:             "2025-09-01T00:00:00Z",
			Mode:             "as_of",
			TargetVersionIDs: []string{"v1"},
			VersionID:        "v1",
		},
	}, lookup)
	if err != nil {
		t.Fatalf("resolved as_of rescue decision: %v", err)
	}
	if rescueApplied || reason != "answer_bearing_evidence_present" {
		t.Fatalf("resolved as_of rescue = applied:%v reason:%q, want covered", rescueApplied, reason)
	}
}
