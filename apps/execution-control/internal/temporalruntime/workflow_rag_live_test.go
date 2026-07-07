package temporalruntime

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
)

func TestToolExecutionWorkflowRunsLiveRAGPlanThroughLiveSourceLookup(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 52, 0, 0, time.UTC)
	runID := "run-workflow-knowledge-live"
	traceID := "trace-workflow-knowledge-live"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"
	ragPlanRef := "projection://runs/" + runID + "/rag/plan"
	lookupRef := "projection://runs/" + runID + "/retrieval/live-source-lookup"
	evidenceRef := "projection://runs/" + runID + "/evidence/select"
	synthesisRef := "projection://runs/" + runID + "/synthesis/provider"
	groundingRef := "projection://runs/" + runID + "/grounding/verify"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: agentResultRef,
		FinalOutput:    "",
		RunID:          runID,
		SelectedTools:  []string{"knowledge_query"},
		Status:         "completed",
		TerminalReason: "tool_selected",
	}, nil)
	env.OnActivity(PlanRAGActivityName, mock.Anything, mock.Anything).Return(PlanRAGActivityOutput{
		PlanRef: ragPlanRef,
		RunID:   runID,
		Status:  "completed",
		Steps: []RAGPlanStep{{
			StepID:   "live-source-lookup",
			StepType: "live_source_lookup",
		}, {
			StepID:   "evidence-coverage-verify",
			StepType: "evidence_coverage_verify",
		}, {
			StepID:   "supporting-evidence-select",
			StepType: "supporting_evidence_select",
		}},
	}, nil)
	env.OnActivity(
		LiveSourceLookupActivityName,
		mock.Anything,
		mock.MatchedBy(func(input LiveSourceLookupActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.RAGPlanRef == ragPlanRef &&
				len(input.StepTypes) == 1 &&
				input.StepTypes[0] == "live_source_lookup"
		}),
	).Return(LiveSourceLookupActivityOutput{
		LookupRef: lookupRef,
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		SelectEvidenceActivityName,
		mock.Anything,
		mock.MatchedBy(func(input SelectEvidenceActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.RAGPlanRef == ragPlanRef &&
				input.LookupRef == lookupRef
		}),
	).Return(SelectEvidenceActivityOutput{
		EvidenceRef: evidenceRef,
		RunID:       runID,
		Status:      "completed",
	}, nil)
	env.OnActivity(SynthesizeRAGAnswerActivityName, mock.Anything, mock.Anything).Return(SynthesizeRAGAnswerActivityOutput{
		RunID:        runID,
		Status:       "completed",
		SynthesisRef: synthesisRef,
	}, nil)
	env.OnActivity(VerifyGroundingActivityName, mock.Anything, mock.Anything).Return(VerifyGroundingActivityOutput{
		GroundingRef: groundingRef,
		RunID:        runID,
		Status:       "completed",
	}, nil)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(ToolExecutionWorkflow, ToolExecutionWorkflowInput{
		ConversationID:   "conv-workflow-knowledge-live",
		Namespace:        "campus-agent-test",
		PayloadSHA256:    "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:        "req-workflow-knowledge-live",
		RunID:            runID,
		TaskQueue:        WorkflowTaskQueue,
		TraceID:          traceID,
		TurnID:           "turn-workflow-knowledge-live",
		VisibleToolNames: []string{"knowledge_query"},
		WorkflowID:       "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertNotCalled(t, RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestToolExecutionWorkflowFailsClosedForUnsupportedRAGRetrievalStep(t *testing.T) {
	assertWorkflowFailsClosedForUnsupportedRAGRetrievalStep(t, "made_up_retrieval")
}

func TestToolExecutionWorkflowRejectsNonExecutableLiveSourceLookupStep(t *testing.T) {
	assertWorkflowFailsClosedForUnsupportedRAGRetrievalStep(t, "parent_context_expand")
}

func assertWorkflowFailsClosedForUnsupportedRAGRetrievalStep(t *testing.T, stepType string) {
	t.Helper()
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-workflow-knowledge-unsupported-step-" + strings.ReplaceAll(stepType, "_", "-")
	traceID := "trace-workflow-knowledge-unsupported-step"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + runID + "/agent/primary/result",
		RunID:          runID,
		SelectedTools:  []string{"knowledge_query"},
		Status:         "completed",
		TerminalReason: "tool_selected",
	}, nil)
	env.OnActivity(PlanRAGActivityName, mock.Anything, mock.Anything).Return(PlanRAGActivityOutput{
		PlanRef: "projection://runs/" + runID + "/rag/plan",
		RunID:   runID,
		Status:  "completed",
		Steps: []RAGPlanStep{{
			StepID:   "made-up-step",
			StepType: stepType,
		}},
	}, nil)

	env.ExecuteWorkflow(ToolExecutionWorkflow, ToolExecutionWorkflowInput{
		ConversationID:   "conv-workflow-knowledge-unsupported-step",
		Namespace:        "campus-agent-test",
		PayloadSHA256:    "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:        "req-workflow-knowledge-unsupported-step",
		RunID:            runID,
		TaskQueue:        WorkflowTaskQueue,
		TraceID:          traceID,
		TurnID:           "turn-workflow-knowledge-unsupported-step",
		VisibleToolNames: []string{"knowledge_query"},
		WorkflowID:       "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	err := env.GetWorkflowError()
	if err == nil {
		t.Fatal("unsupported rag retrieval step must fail closed")
	}
	if !strings.Contains(err.Error(), "unsupported rag retrieval step_type") {
		t.Fatalf("workflow error = %v, want unsupported step diagnostic", err)
	}
	env.AssertNotCalled(t, RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, LiveSourceLookupActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}
