package temporalruntime

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

func TestCapabilityExecutionWorkflowExecutesKnowledgeBranch(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(memoryRecallInputMatcher("run-workflow-001")),
	).Return(
		MemoryRecallActivityOutput{
			MemoryRef:           "projection://runs/run-workflow-001/memory/recall",
			RunID:               "run-workflow-001",
			SelectedMemoryChars: 0,
			SelectedMemoryCount: 0,
			Status:              "completed",
		},
		nil,
	)
	env.OnActivity(
		PlanRouteActivityName,
		mock.Anything,
		mock.MatchedBy(planInputMatcher("run-workflow-001")),
	).Return(
		PlanRouteActivityOutput{
			Capability:  "knowledge",
			PlanRef:     "projection://runs/run-workflow-001/plan/route",
			RunID:       "run-workflow-001",
			Status:      "planned",
			ToolName:    "retrieval.query",
			WorkerRole:  "activity-worker-knowledge",
			PayloadKind: "rag_request",
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

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
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
	var result CapabilityExecutionWorkflowResult
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

func TestCapabilityExecutionWorkflowExecutesCampusServicesTypedToolBranch(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 2, 3, 4, 0, time.UTC)
	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.RequestedCapability == "campus_services"
		}),
	).Return(
		MemoryRecallActivityOutput{
			MemoryRef:           "projection://runs/run-campus-services-001/memory/recall",
			RunID:               "run-campus-services-001",
			SelectedMemoryChars: 0,
			SelectedMemoryCount: 0,
			Status:              "completed",
		},
		nil,
	)
	env.OnActivity(
		PlanRouteActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PlanRouteActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.RequestedCapability == "campus_services"
		}),
	).Return(
		PlanRouteActivityOutput{
			Capability:  "campus_services",
			PlanRef:     "projection://runs/run-campus-services-001/plan/route",
			RunID:       "run-campus-services-001",
			Status:      "planned",
			ToolName:    "service_status_lookup",
			WorkerRole:  "activity-worker-campus-services",
			PayloadKind: "service_status_lookup",
		},
		nil,
	)
	env.OnActivity(
		ExecuteTypedToolActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecuteTypedToolActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.Capability == "campus_services" &&
				input.ToolName == "service_status_lookup" &&
				input.PayloadKind == "service_status_lookup" &&
				input.RoutePlanRef == "projection://runs/run-campus-services-001/plan/route"
		}),
	).Return(
		ExecuteTypedToolActivityOutput{
			Capability:  "campus_services",
			ResultRef:   "projection://runs/run-campus-services-001/tools/service_status_lookup",
			RunID:       "run-campus-services-001",
			Status:      "completed",
			ToolName:    "service_status_lookup",
			PayloadKind: "service_status_lookup",
		},
		nil,
	)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.ToolResultRef == "projection://runs/run-campus-services-001/tools/service_status_lookup" &&
				input.SelectedCapability == "campus_services" &&
				input.SelectedTool == "service_status_lookup" &&
				input.GroundingRef == "" &&
				input.SynthesisRef == ""
		}),
	).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/run-campus-services-001/finalization",
			RunID:         "run-campus-services-001",
			Status:        "completed",
		},
		nil,
	)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-campus-services-001",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "3f0a4a5f0d2ed0cecbfb4c72dc90653d4f484ba5856ea35f246fb3c3a37c78fe",
		RequestID:           "req-campus-services-001",
		RequestedCapability: "campus_services",
		RunID:               "run-campus-services-001",
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             "trace-campus-services-001",
		TurnID:              "turn-campus-services-001",
		WorkflowID:          "campus-agent.chat.run-campus-services-001",
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result CapabilityExecutionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RunID != "run-campus-services-001" || result.Status != "completed" {
		t.Fatalf("unexpected result: %#v", result)
	}
	env.AssertNotCalled(t, PlanRAGActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, SynthesizeRAGAnswerActivityName, mock.Anything, mock.Anything)
}

func TestWorkerRuntimeRequiresFinalizationActivities(t *testing.T) {
	_, err := NewWorkerRuntime(context.Background(), WorkerOptions{
		Address:                "127.0.0.1:1",
		Namespace:              "campus-agent-test",
		WorkflowQueue:          WorkflowTaskQueue,
		ContextQueue:           ActivityTaskQueueContext,
		KnowledgeQueue:         ActivityTaskQueueKnowledge,
		FinalizationQueue:      ActivityTaskQueueFinalization,
		ContextActivities:      &Activities{},
		KnowledgeActivities:    &Activities{},
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

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities) {
	env.RegisterActivityWithOptions(activities.MemoryRecallActivity, activity.RegisterOptions{Name: MemoryRecallActivityName})
	env.RegisterActivityWithOptions(activities.PlanRouteActivity, activity.RegisterOptions{Name: PlanRouteActivityName})
	env.RegisterActivityWithOptions(activities.PlanRAGActivity, activity.RegisterOptions{Name: PlanRAGActivityName})
	env.RegisterActivityWithOptions(
		activities.RetrieveIndexedLookupActivity,
		activity.RegisterOptions{Name: RetrieveIndexedLookupActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExpandOrRescueRetrievalActivity,
		activity.RegisterOptions{Name: ExpandOrRescueRetrievalActivityName},
	)
	env.RegisterActivityWithOptions(activities.SelectEvidenceActivity, activity.RegisterOptions{Name: SelectEvidenceActivityName})
	env.RegisterActivityWithOptions(
		activities.SynthesizeRAGAnswerActivity,
		activity.RegisterOptions{Name: SynthesizeRAGAnswerActivityName},
	)
	env.RegisterActivityWithOptions(activities.VerifyGroundingActivity, activity.RegisterOptions{Name: VerifyGroundingActivityName})
	env.RegisterActivityWithOptions(activities.ExecuteTypedToolActivity, activity.RegisterOptions{Name: ExecuteTypedToolActivityName})
	env.RegisterActivityWithOptions(activities.WriteFinalizationActivity, activity.RegisterOptions{Name: WriteFinalizationActivityName})
}

func (Activities) MemoryRecallActivity(
	_ context.Context,
	input MemoryRecallActivityInput,
) (MemoryRecallActivityOutput, error) {
	return MemoryRecallActivityOutput{
		MemoryRef:           "projection://runs/" + input.RunID + "/memory/recall",
		RunID:               input.RunID,
		SelectedMemoryChars: 0,
		SelectedMemoryCount: 0,
		Status:              "completed",
	}, nil
}

func (Activities) PlanRouteActivity(
	_ context.Context,
	input PlanRouteActivityInput,
) (PlanRouteActivityOutput, error) {
	capability := input.RequestedCapability
	if capability == "" {
		capability = "knowledge"
	}
	if capability == "campus_services" {
		return PlanRouteActivityOutput{
			Capability:  "campus_services",
			PlanRef:     "projection://runs/" + input.RunID + "/plan/route",
			RunID:       input.RunID,
			Status:      "planned",
			ToolName:    "service_status_lookup",
			WorkerRole:  "activity-worker-campus-services",
			PayloadKind: "service_status_lookup",
		}, nil
	}
	return PlanRouteActivityOutput{
		Capability:  "knowledge",
		PlanRef:     "projection://runs/" + input.RunID + "/plan/route",
		RunID:       input.RunID,
		Status:      "planned",
		ToolName:    "retrieval.query",
		WorkerRole:  "activity-worker-knowledge",
		PayloadKind: "rag_request",
	}, nil
}

func (Activities) ExecuteTypedToolActivity(
	_ context.Context,
	input ExecuteTypedToolActivityInput,
) (ExecuteTypedToolActivityOutput, error) {
	return ExecuteTypedToolActivityOutput{
		Capability:  input.Capability,
		ResultRef:   "projection://runs/" + input.RunID + "/tools/" + input.ToolName,
		RunID:       input.RunID,
		Status:      "completed",
		ToolName:    input.ToolName,
		PayloadKind: input.PayloadKind,
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

func memoryRecallInputMatcher(runID string) func(MemoryRecallActivityInput) bool {
	return func(input MemoryRecallActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.RequestID == "req-workflow-001" &&
			input.RequestedCapability == "knowledge"
	}
}

func planInputMatcher(runID string) func(PlanRouteActivityInput) bool {
	return func(input PlanRouteActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PayloadSHA256 != "" &&
			input.RequestedCapability == "knowledge"
	}
}

func ragPlanInputMatcher(runID string) func(PlanRAGActivityInput) bool {
	return func(input PlanRAGActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.WorkflowPlanRef == "projection://runs/run-workflow-001/plan/route"
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
