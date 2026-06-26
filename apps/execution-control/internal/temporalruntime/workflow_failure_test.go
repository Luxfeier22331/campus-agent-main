package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestCapabilityExecutionWorkflowFailsClosedWhenKnowledgeBranchActivityFails(t *testing.T) {
	cases := []struct {
		name      string
		failStep  string
		configure func(*mockedKnowledgeWorkflow)
	}{
		{
			name:     "plan rag",
			failStep: PlanRAGActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.failPlanRAG()
			},
		},
		{
			name:     "retrieve indexed lookup",
			failStep: RetrieveIndexedLookupActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.planRAG()
				flow.failRetrieve()
			},
		},
		{
			name:     "expand or rescue retrieval",
			failStep: ExpandOrRescueRetrievalActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.planRAG()
				flow.retrieve()
				flow.failExpand()
			},
		},
		{
			name:     "select evidence",
			failStep: SelectEvidenceActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.planRAG()
				flow.retrieve()
				flow.expand()
				flow.failSelectEvidence()
			},
		},
		{
			name:     "synthesize answer",
			failStep: SynthesizeRAGAnswerActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.planRAG()
				flow.retrieve()
				flow.expand()
				flow.selectEvidence()
				flow.failSynthesis()
			},
		},
		{
			name:     "verify grounding",
			failStep: VerifyGroundingActivityName,
			configure: func(flow *mockedKnowledgeWorkflow) {
				flow.planRAG()
				flow.retrieve()
				flow.expand()
				flow.selectEvidence()
				flow.synthesize()
				flow.failGrounding()
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := newWorkflowTestEnvironment()
			runID := "run-knowledge-fail-" + strings.ReplaceAll(tc.name, " ", "-")
			flow := newMockedKnowledgeWorkflow(env, runID)
			flow.memoryRecall()
			flow.primarySelectsKnowledge()
			tc.configure(flow)

			env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

			if !env.IsWorkflowCompleted() {
				t.Fatal("workflow did not complete")
			}
			err := env.GetWorkflowError()
			if err == nil {
				t.Fatal("expected workflow error")
			}
			if !strings.Contains(err.Error(), "forced "+tc.failStep+" failure") {
				t.Fatalf("workflow error = %v, want forced failure for %s", err, tc.failStep)
			}
			env.AssertNotCalled(t, WriteFinalizationActivityName, mock.Anything, mock.Anything)
			env.AssertNotCalled(t, AppendConversationMemoryActivityName, mock.Anything, mock.Anything)
			env.AssertExpectations(t)
		})
	}
}

func TestCapabilityExecutionWorkflowHonorsActivityRetryPolicy(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-memory-retry-policy"
	var attempts int32

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.Anything,
	).Return(func(_ context.Context, input MemoryRecallActivityInput) (MemoryRecallActivityOutput, error) {
		attempt := atomic.AddInt32(&attempts, 1)
		if attempt < 3 {
			return MemoryRecallActivityOutput{}, errors.New("transient memory recall failure")
		}
		return MemoryRecallActivityOutput{
			MemoryRef: "projection://runs/" + input.RunID + "/memory/recall",
			RunID:     input.RunID,
			Status:    "completed",
		}, nil
	})
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + runID + "/agent/primary/result",
			FinalOutput:    "retry succeeded",
			RunID:          runID,
			Status:         "completed",
			TerminalReason: "answer_completed",
		},
		nil,
	)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   time.Date(2026, 6, 20, 1, 2, 3, 0, time.UTC),
			ProjectionRef: "projection://runs/" + runID + "/finalization",
			RunID:         runID,
			Status:        "completed",
		},
		nil,
	)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if err := expectWorkflowCompletedWithoutError(env); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("memory recall attempts = %d, want 3", attempts)
	}
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowDoesNotRetryNonRetryableActivityError(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-memory-non-retryable"
	var attempts int32

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.Anything,
	).Return(func(context.Context, MemoryRecallActivityInput) (MemoryRecallActivityOutput, error) {
		atomic.AddInt32(&attempts, 1)
		return MemoryRecallActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"memory projection is invalid",
			"memory_projection_invalid",
			nil,
		)
	})

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("expected workflow error")
	}
	if attempts != 1 {
		t.Fatalf("memory recall attempts = %d, want 1", attempts)
	}
	env.AssertNotCalled(t, ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, WriteFinalizationActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowPropagatesFinalizationFailureWithoutMemoryAppend(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-finalization-fails"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + runID + "/agent/primary/result",
			FinalOutput:    "answer",
			RunID:          runID,
			Status:         "completed",
			TerminalReason: "answer_completed",
		},
		nil,
	)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WriteFinalizationActivityOutput{},
		errors.New("forced finalization failure"),
	)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	err := env.GetWorkflowError()
	if err == nil || !strings.Contains(err.Error(), "forced finalization failure") {
		t.Fatalf("workflow error = %v, want finalization failure", err)
	}
	env.AssertNotCalled(t, AppendConversationMemoryActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowIgnoresMemoryAppendFailureAfterFinalization(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-memory-append-fails"
	completedAt := time.Date(2026, 6, 20, 2, 3, 4, 0, time.UTC)

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef: "projection://runs/" + runID + "/agent/primary/result",
			FinalOutput:    "answer",
			RunID:          runID,
			Status:         "completed",
			TerminalReason: "answer_completed",
		},
		nil,
	)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + runID + "/finalization",
			RunID:         runID,
			Status:        "completed",
		},
		nil,
	)
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(
		AppendConversationMemoryActivityOutput{},
		errors.New("forced memory append failure"),
	)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if err := expectWorkflowCompletedWithoutError(env); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result CapabilityExecutionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.ProjectionRef != "projection://runs/"+runID+"/finalization" {
		t.Fatalf("projection ref = %q", result.ProjectionRef)
	}
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowCancelBeforeFinalizationStopsMemoryAppend(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-cancel-before-finalization"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(
		func(ctx context.Context, input ExecutePrimaryAgentActivityInput) (ExecutePrimaryAgentActivityOutput, error) {
			select {
			case <-ctx.Done():
				return ExecutePrimaryAgentActivityOutput{}, ctx.Err()
			case <-time.After(200 * time.Millisecond):
				return ExecutePrimaryAgentActivityOutput{
					AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
					RunID:          input.RunID,
					Status:         "completed",
					TerminalReason: "answer_completed",
				}, nil
			}
		},
	)
	env.RegisterDelayedCallback(func() {
		env.CancelWorkflow()
	}, 10*time.Millisecond)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("expected workflow cancellation error")
	}
	env.AssertNotCalled(t, WriteFinalizationActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, AppendConversationMemoryActivityName, mock.Anything, mock.Anything)
}

type mockedKnowledgeWorkflow struct {
	env interface {
		OnActivity(any, ...any) *testsuite.MockCallWrapper
	}
	runID           string
	agentResultRef  string
	ragPlanRef      string
	lookupRef       string
	rescueRef       string
	evidenceRef     string
	synthesisRef    string
	groundingRef    string
	forcedErrorByID map[string]error
}

func newMockedKnowledgeWorkflow(
	env interface {
		OnActivity(any, ...any) *testsuite.MockCallWrapper
	},
	runID string,
) *mockedKnowledgeWorkflow {
	return &mockedKnowledgeWorkflow{
		env:            env,
		runID:          runID,
		agentResultRef: "projection://runs/" + runID + "/agent/primary/result",
		ragPlanRef:     "projection://runs/" + runID + "/rag/plan",
		lookupRef:      "projection://runs/" + runID + "/retrieval/lookup",
		rescueRef:      "projection://runs/" + runID + "/retrieval/rescue",
		evidenceRef:    "projection://runs/" + runID + "/evidence/select",
		synthesisRef:   "projection://runs/" + runID + "/synthesis/provider",
		groundingRef:   "projection://runs/" + runID + "/grounding/verify",
	}
}

func (m *mockedKnowledgeWorkflow) memoryRecall() {
	m.env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + m.runID + "/memory/recall",
		RunID:     m.runID,
		Status:    "completed",
	}, nil)
}

func (m *mockedKnowledgeWorkflow) primarySelectsKnowledge() {
	m.env.OnActivity(ExecutePrimaryAgentActivityName, mock.Anything, mock.Anything).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef: m.agentResultRef,
			RunID:          m.runID,
			SelectedTools:  []string{"knowledge_query"},
			Status:         "completed",
			TerminalReason: "tool_selected",
		},
		nil,
	)
}

func (m *mockedKnowledgeWorkflow) planRAG() {
	m.env.OnActivity(PlanRAGActivityName, mock.Anything, mock.Anything).Return(PlanRAGActivityOutput{
		PlanRef: m.ragPlanRef,
		RunID:   m.runID,
		Status:  "completed",
	}, nil)
}

func (m *mockedKnowledgeWorkflow) failPlanRAG() {
	m.env.OnActivity(PlanRAGActivityName, mock.Anything, mock.Anything).Return(
		PlanRAGActivityOutput{},
		errors.New("forced "+PlanRAGActivityName+" failure"),
	)
}

func (m *mockedKnowledgeWorkflow) retrieve() {
	m.env.OnActivity(RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything).Return(
		RetrieveIndexedLookupActivityOutput{
			LookupRef: m.lookupRef,
			RunID:     m.runID,
			Status:    "completed",
		},
		nil,
	)
}

func (m *mockedKnowledgeWorkflow) failRetrieve() {
	m.env.OnActivity(RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything).Return(
		RetrieveIndexedLookupActivityOutput{},
		errors.New("forced "+RetrieveIndexedLookupActivityName+" failure"),
	)
}

func (m *mockedKnowledgeWorkflow) expand() {
	m.env.OnActivity(ExpandOrRescueRetrievalActivityName, mock.Anything, mock.Anything).Return(
		ExpandOrRescueRetrievalActivityOutput{
			LookupRef: m.lookupRef,
			RescueRef: m.rescueRef,
			RunID:     m.runID,
			Status:    "completed",
		},
		nil,
	)
}

func (m *mockedKnowledgeWorkflow) failExpand() {
	m.env.OnActivity(ExpandOrRescueRetrievalActivityName, mock.Anything, mock.Anything).Return(
		ExpandOrRescueRetrievalActivityOutput{},
		errors.New("forced "+ExpandOrRescueRetrievalActivityName+" failure"),
	)
}

func (m *mockedKnowledgeWorkflow) selectEvidence() {
	m.env.OnActivity(SelectEvidenceActivityName, mock.Anything, mock.Anything).Return(
		SelectEvidenceActivityOutput{
			EvidenceRef: m.evidenceRef,
			RunID:       m.runID,
			Status:      "completed",
		},
		nil,
	)
}

func (m *mockedKnowledgeWorkflow) failSelectEvidence() {
	m.env.OnActivity(SelectEvidenceActivityName, mock.Anything, mock.Anything).Return(
		SelectEvidenceActivityOutput{},
		errors.New("forced "+SelectEvidenceActivityName+" failure"),
	)
}

func (m *mockedKnowledgeWorkflow) synthesize() {
	m.env.OnActivity(SynthesizeRAGAnswerActivityName, mock.Anything, mock.Anything).Return(
		SynthesizeRAGAnswerActivityOutput{
			RunID:        m.runID,
			Status:       "completed",
			SynthesisRef: m.synthesisRef,
		},
		nil,
	)
}

func (m *mockedKnowledgeWorkflow) failSynthesis() {
	m.env.OnActivity(SynthesizeRAGAnswerActivityName, mock.Anything, mock.Anything).Return(
		SynthesizeRAGAnswerActivityOutput{},
		errors.New("forced "+SynthesizeRAGAnswerActivityName+" failure"),
	)
}

func (m *mockedKnowledgeWorkflow) failGrounding() {
	m.env.OnActivity(VerifyGroundingActivityName, mock.Anything, mock.Anything).Return(
		VerifyGroundingActivityOutput{},
		errors.New("forced "+VerifyGroundingActivityName+" failure"),
	)
}

func TestDefaultActivityTaskQueueRoutingForWorkflowActivities(t *testing.T) {
	env := newWorkflowTestEnvironment()
	runID := "run-task-queue-routing"
	seenQueues := map[string]string{}
	env.SetOnActivityStartedListener(func(info *activity.Info, _ context.Context, _ converter.EncodedValues) {
		seenQueues[info.ActivityType.Name] = info.TaskQueue
	})

	flow := newMockedKnowledgeWorkflow(env, runID)
	flow.memoryRecall()
	flow.primarySelectsKnowledge()
	flow.planRAG()
	flow.retrieve()
	flow.expand()
	flow.selectEvidence()
	flow.synthesize()
	env.OnActivity(VerifyGroundingActivityName, mock.Anything, mock.Anything).Return(
		VerifyGroundingActivityOutput{
			GroundingRef: flow.groundingRef,
			RunID:        runID,
			Status:       "completed",
		},
		nil,
	)
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   time.Date(2026, 6, 20, 3, 4, 5, 0, time.UTC),
			ProjectionRef: "projection://runs/" + runID + "/finalization",
			RunID:         runID,
			Status:        "completed",
		},
		nil,
	)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, workflowTestInput(runID))

	if err := expectWorkflowCompletedWithoutError(env); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	want := map[string]string{
		MemoryRecallActivityName:            ActivityTaskQueueContext,
		ExecutePrimaryAgentActivityName:     ActivityTaskQueueAgent,
		PlanRAGActivityName:                 ActivityTaskQueueKnowledgePlan,
		RetrieveIndexedLookupActivityName:   ActivityTaskQueueKnowledgeRetrieval,
		ExpandOrRescueRetrievalActivityName: ActivityTaskQueueKnowledgeRetrieval,
		SelectEvidenceActivityName:          ActivityTaskQueueKnowledgePlan,
		SynthesizeRAGAnswerActivityName:     ActivityTaskQueueKnowledgeSynthesis,
		VerifyGroundingActivityName:         ActivityTaskQueueKnowledgePlan,
		WriteFinalizationActivityName:       ActivityTaskQueueFinalization,
	}
	for activityName, taskQueue := range want {
		if seenQueues[activityName] != taskQueue {
			t.Fatalf("%s task queue = %q, want %q", activityName, seenQueues[activityName], taskQueue)
		}
	}
}
