package temporalruntime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestChatAnswerWorkflowExecutesTypedStepGraph(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterActivity(&Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	env.OnActivity(
		PlanChatAnswerActivityName,
		mock.Anything,
		mock.MatchedBy(planInputMatcher("run-workflow-001")),
	).Return(
		PlanChatAnswerActivityOutput{
			PlanRef: "projection://runs/run-workflow-001/plan",
			RunID:   "run-workflow-001",
			Status:  "planned",
		},
		nil,
	)
	env.OnActivity(
		PlanRAGActivityName,
		mock.Anything,
		mock.MatchedBy(ragPlanInputMatcher("run-workflow-001")),
	).Return(
		PlanRAGActivityOutput{
			PlanRef: "projection://runs/run-workflow-001/rag/plan",
			RunID:   "run-workflow-001",
			Status:  "completed",
		},
		nil,
	)
	env.OnActivity(
		RetrieveIndexedLookupActivityName,
		mock.Anything,
		mock.MatchedBy(retrievalLookupInputMatcher("run-workflow-001")),
	).Return(
		RetrieveIndexedLookupActivityOutput{
			LookupRef: "projection://runs/run-workflow-001/retrieval/indexed-lookup",
			RunID:     "run-workflow-001",
			Status:    "completed",
		},
		nil,
	)
	env.OnActivity(
		ExpandOrRescueRetrievalActivityName,
		mock.Anything,
		mock.MatchedBy(retrievalRescueInputMatcher("run-workflow-001")),
	).Return(
		ExpandOrRescueRetrievalActivityOutput{
			LookupRef: "projection://runs/run-workflow-001/retrieval/indexed-lookup",
			RescueRef: "projection://runs/run-workflow-001/retrieval/expand-or-rescue",
			RunID:     "run-workflow-001",
			Status:    "completed",
		},
		nil,
	)
	env.OnActivity(
		SelectEvidenceActivityName,
		mock.Anything,
		mock.MatchedBy(evidenceSelectionInputMatcher("run-workflow-001")),
	).Return(
		SelectEvidenceActivityOutput{
			EvidenceRef: "projection://runs/run-workflow-001/evidence/selection",
			RunID:       "run-workflow-001",
			Status:      "completed",
		},
		nil,
	)
	env.OnActivity(
		SynthesizeRAGAnswerActivityName,
		mock.Anything,
		mock.MatchedBy(synthesisInputMatcher("run-workflow-001")),
	).Return(
		SynthesizeRAGAnswerActivityOutput{
			SynthesisRef: "projection://runs/run-workflow-001/synthesis/provider",
			RunID:        "run-workflow-001",
			Status:       "completed",
		},
		nil,
	)
	env.OnActivity(
		VerifyGroundingActivityName,
		mock.Anything,
		mock.MatchedBy(groundingInputMatcher("run-workflow-001")),
	).Return(
		VerifyGroundingActivityOutput{
			GroundingRef: "projection://runs/run-workflow-001/grounding/verify",
			RunID:        "run-workflow-001",
			Status:       "completed",
		},
		nil,
	)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(finalizeInputMatcher("run-workflow-001")),
	).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/run-workflow-001/finalization",
			RunID:         "run-workflow-001",
			Status:        "completed",
		},
		nil,
	)

	env.ExecuteWorkflow(ChatAnswerWorkflow, ChatAnswerWorkflowInput{
		ConversationID: "conv-workflow-001",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:      "req-workflow-001",
		RunID:          "run-workflow-001",
		TaskQueue:      WorkflowTaskQueue,
		TraceID:        "trace-workflow-001",
		TurnID:         "turn-workflow-001",
		WorkflowID:     "campus-agent.chat.run-workflow-001",
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result ChatAnswerWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RunID != "run-workflow-001" || result.Status != "completed" {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.ProjectionRef != "projection://runs/run-workflow-001/finalization" {
		t.Fatalf("projection ref = %q", result.ProjectionRef)
	}
}

func TestWorkerRuntimeRequiresFinalizationActivities(t *testing.T) {
	_, err := NewWorkerRuntime(context.Background(), WorkerOptions{
		Address:                "127.0.0.1:1",
		Namespace:              "campus-agent-test",
		WorkflowQueue:          WorkflowTaskQueue,
		RAGQueue:               ActivityTaskQueueRAG,
		FinalizationQueue:      ActivityTaskQueueFinalization,
		RAGActivities:          &Activities{},
		FinalizationActivities: nil,
	})
	if err == nil {
		t.Fatal("expected missing finalization activities to fail")
	}
	if !strings.Contains(err.Error(), "temporal finalization activities are required") {
		t.Fatalf("error = %q", err.Error())
	}
}

type Activities struct{}

func (Activities) PlanChatAnswerActivity(
	_ context.Context,
	input PlanChatAnswerActivityInput,
) (PlanChatAnswerActivityOutput, error) {
	return PlanChatAnswerActivityOutput{
		PlanRef: "projection://runs/" + input.RunID + "/plan",
		RunID:   input.RunID,
		Status:  "planned",
	}, nil
}

func (Activities) PlanRAGActivity(
	_ context.Context,
	input PlanRAGActivityInput,
) (PlanRAGActivityOutput, error) {
	return PlanRAGActivityOutput{
		PlanRef: "projection://runs/" + input.RunID + "/rag/plan",
		RunID:   input.RunID,
		Status:  "completed",
	}, nil
}

func (Activities) RetrieveIndexedLookupActivity(
	_ context.Context,
	input RetrieveIndexedLookupActivityInput,
) (RetrieveIndexedLookupActivityOutput, error) {
	return RetrieveIndexedLookupActivityOutput{
		LookupRef: "projection://runs/" + input.RunID + "/retrieval/indexed-lookup",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) ExpandOrRescueRetrievalActivity(
	_ context.Context,
	input ExpandOrRescueRetrievalActivityInput,
) (ExpandOrRescueRetrievalActivityOutput, error) {
	return ExpandOrRescueRetrievalActivityOutput{
		LookupRef: input.LookupRef,
		RescueRef: "projection://runs/" + input.RunID + "/retrieval/expand-or-rescue",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) SelectEvidenceActivity(
	_ context.Context,
	input SelectEvidenceActivityInput,
) (SelectEvidenceActivityOutput, error) {
	return SelectEvidenceActivityOutput{
		EvidenceRef: "projection://runs/" + input.RunID + "/evidence/selection",
		RunID:       input.RunID,
		Status:      "completed",
	}, nil
}

func (Activities) SynthesizeRAGAnswerActivity(
	_ context.Context,
	input SynthesizeRAGAnswerActivityInput,
) (SynthesizeRAGAnswerActivityOutput, error) {
	return SynthesizeRAGAnswerActivityOutput{
		SynthesisRef: "projection://runs/" + input.RunID + "/synthesis/provider",
		RunID:        input.RunID,
		Status:       "completed",
	}, nil
}

func (Activities) VerifyGroundingActivity(
	_ context.Context,
	input VerifyGroundingActivityInput,
) (VerifyGroundingActivityOutput, error) {
	return VerifyGroundingActivityOutput{
		GroundingRef: "projection://runs/" + input.RunID + "/grounding/verify",
		RunID:        input.RunID,
		Status:       "completed",
	}, nil
}

func (Activities) WriteFinalizationActivity(
	_ context.Context,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	return WriteFinalizationActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RunID + "/finalization",
		RunID:         input.RunID,
		Status:        "completed",
	}, nil
}

func planInputMatcher(runID string) func(PlanChatAnswerActivityInput) bool {
	return func(input PlanChatAnswerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PayloadSHA256 != ""
	}
}

func ragPlanInputMatcher(runID string) func(PlanRAGActivityInput) bool {
	return func(input PlanRAGActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.WorkflowPlanRef == "projection://runs/run-workflow-001/plan"
	}
}

func retrievalLookupInputMatcher(runID string) func(RetrieveIndexedLookupActivityInput) bool {
	return func(input RetrieveIndexedLookupActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan"
	}
}

func retrievalRescueInputMatcher(runID string) func(ExpandOrRescueRetrievalActivityInput) bool {
	return func(input ExpandOrRescueRetrievalActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.LookupRef == "projection://runs/run-workflow-001/retrieval/indexed-lookup"
	}
}

func evidenceSelectionInputMatcher(runID string) func(SelectEvidenceActivityInput) bool {
	return func(input SelectEvidenceActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.LookupRef == "projection://runs/run-workflow-001/retrieval/indexed-lookup" &&
			input.RescueRef == "projection://runs/run-workflow-001/retrieval/expand-or-rescue"
	}
}

func synthesisInputMatcher(runID string) func(SynthesizeRAGAnswerActivityInput) bool {
	return func(input SynthesizeRAGAnswerActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RAGPlanRef == "projection://runs/run-workflow-001/rag/plan" &&
			input.EvidenceRef == "projection://runs/run-workflow-001/evidence/selection"
	}
}

func groundingInputMatcher(runID string) func(VerifyGroundingActivityInput) bool {
	return func(input VerifyGroundingActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.EvidenceRef == "projection://runs/run-workflow-001/evidence/selection" &&
			input.SynthesisRef == "projection://runs/run-workflow-001/synthesis/provider"
	}
}

func finalizeInputMatcher(runID string) func(WriteFinalizationActivityInput) bool {
	return func(input WriteFinalizationActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.GroundingRef == "projection://runs/run-workflow-001/grounding/verify" &&
			input.SynthesisRef == "projection://runs/run-workflow-001/synthesis/provider"
	}
}
