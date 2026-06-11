package temporalruntime

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/mock"
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

func TestCapabilityExecutionWorkflowExecutesResolvedMultiStepCapabilityBranch(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 3, 4, 5, 0, time.UTC)
	runID := "run-campus-multistep-001"
	traceID := "trace-campus-multistep-001"
	planRef := "projection://runs/" + runID + "/plan/route"
	scheduleRef := "projection://runs/" + runID + "/tools/transport_schedule_lookup"
	changeSetRef := "projection://runs/" + runID + "/tools/campus_notice_change_set_lookup"

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == runID && input.RequestedCapability == "campus_services"
		}),
	).Return(MemoryRecallActivityOutput{
		MemoryRef:           "projection://runs/" + runID + "/memory/recall",
		RunID:               runID,
		SelectedMemoryChars: 0,
		SelectedMemoryCount: 0,
		Status:              "completed",
	}, nil)
	env.OnActivity(
		PlanRouteActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PlanRouteActivityInput) bool {
			return input.RunID == runID && input.RequestedCapability == "campus_services"
		}),
	).Return(PlanRouteActivityOutput{
		Capability:  "campus_services",
		PlanRef:     planRef,
		RunID:       runID,
		Status:      "planned",
		WorkerRole:  "activity-worker-campus-services",
		PayloadKind: "capability_plan",
		Steps: []CapabilityBranchStep{
			{
				AllowedTools: []string{"transport_schedule_lookup"},
				Capability:   "campus_services",
				PayloadKind:  "transport_schedule_lookup",
				StepID:       "capability:campus_services:transport_schedule_lookup",
				ToolName:     "transport_schedule_lookup",
				WorkerRole:   "activity-worker-campus-services",
			},
			{
				AllowedTools: []string{"campus_notice_change_set_lookup"},
				Capability:   "notice",
				PayloadKind:  "campus_notice_change_set_lookup",
				StepID:       "capability:notice:campus_notice_change_set_lookup",
				ToolName:     "campus_notice_change_set_lookup",
				WorkerRole:   "activity-worker-notice",
			},
			{
				Capability:  "knowledge",
				PayloadKind: "rag_request",
				StepID:      "capability:knowledge:rag_request",
				ToolName:    "retrieval.query",
				WorkerRole:  "activity-worker-knowledge",
			},
		},
		WorkflowMode: "multi_step",
	}, nil)
	env.OnActivity(
		ExecuteTypedToolActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecuteTypedToolActivityInput) bool {
			return input.RunID == runID &&
				input.Capability == "campus_services" &&
				input.ToolName == "transport_schedule_lookup" &&
				input.RoutePlanRef == planRef
		}),
	).Return(ExecuteTypedToolActivityOutput{
		Capability:  "campus_services",
		ResultRef:   scheduleRef,
		RunID:       runID,
		Status:      "completed",
		ToolName:    "transport_schedule_lookup",
		PayloadKind: "transport_schedule_lookup",
	}, nil).Once()
	env.OnActivity(
		ExecuteTypedToolActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecuteTypedToolActivityInput) bool {
			return input.RunID == runID &&
				input.Capability == "notice" &&
				input.ToolName == "campus_notice_change_set_lookup" &&
				input.RoutePlanRef == planRef
		}),
	).Return(ExecuteTypedToolActivityOutput{
		Capability:  "notice",
		ResultRef:   changeSetRef,
		RunID:       runID,
		Status:      "completed",
		ToolName:    "campus_notice_change_set_lookup",
		PayloadKind: "campus_notice_change_set_lookup",
	}, nil).Once()
	env.OnActivity(
		PlanRAGActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PlanRAGActivityInput) bool {
			return input.RunID == runID &&
				input.WorkflowPlanRef == planRef &&
				len(input.DependencyResultRefs) == 2 &&
				input.DependencyResultRefs[0] == scheduleRef &&
				input.DependencyResultRefs[1] == changeSetRef
		}),
	).Return(PlanRAGActivityOutput{
		PlanRef: "projection://runs/" + runID + "/rag/plan",
		RunID:   runID,
		Status:  "completed",
	}, nil)
	env.OnActivity(RetrieveIndexedLookupActivityName, mock.Anything, mock.Anything).
		Return(RetrieveIndexedLookupActivityOutput{LookupRef: "projection://runs/" + runID + "/retrieval/indexed-lookup", RunID: runID, Status: "completed"}, nil)
	env.OnActivity(ExpandOrRescueRetrievalActivityName, mock.Anything, mock.Anything).
		Return(ExpandOrRescueRetrievalActivityOutput{LookupRef: "projection://runs/" + runID + "/retrieval/indexed-lookup", RescueRef: "projection://runs/" + runID + "/retrieval/expand-or-rescue", RunID: runID, Status: "completed"}, nil)
	env.OnActivity(SelectEvidenceActivityName, mock.Anything, mock.Anything).
		Return(SelectEvidenceActivityOutput{EvidenceRef: "projection://runs/" + runID + "/evidence/selection", RunID: runID, Status: "completed"}, nil)
	env.OnActivity(SynthesizeRAGAnswerActivityName, mock.Anything, mock.Anything).
		Return(SynthesizeRAGAnswerActivityOutput{SynthesisRef: "projection://runs/" + runID + "/synthesis/provider", RunID: runID, Status: "completed"}, nil)
	env.OnActivity(VerifyGroundingActivityName, mock.Anything, mock.Anything).
		Return(VerifyGroundingActivityOutput{GroundingRef: "projection://runs/" + runID + "/grounding/verify", RunID: runID, Status: "completed"}, nil)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.SelectedCapability == "campus_services" &&
				input.GroundingRef == "projection://runs/"+runID+"/grounding/verify" &&
				input.SynthesisRef == "projection://runs/"+runID+"/synthesis/provider"
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-campus-multistep-001",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "3f0a4a5f0d2ed0cecbfb4c72dc90653d4f484ba5856ea35f246fb3c3a37c78fe",
		RequestID:           "req-campus-multistep-001",
		RequestedCapability: "campus_services",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             traceID,
		TurnID:              "turn-campus-multistep-001",
		WorkflowID:          "campus-agent.chat." + runID,
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
	if result.RunID != runID || result.Status != "completed" {
		t.Fatalf("unexpected result: %#v", result)
	}
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowReplansFailedTypedToolWithinBudget(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 4, 5, 6, 0, time.UTC)
	runID := "run-replan-001"
	planRef := "projection://runs/" + runID + "/plan/route"
	replanRef := "projection://runs/" + runID + "/plan/replan/1"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{RunID: runID, MemoryRef: "projection://runs/" + runID + "/memory/recall", Status: "completed"}, nil)
	env.OnActivity(PlanRouteActivityName, mock.Anything, mock.Anything).
		Return(PlanRouteActivityOutput{
			AllowedCapabilities: []string{"campus_services"},
			AllowedTools:        []string{"service_status_lookup"},
			Capability:          "campus_services",
			MaxReplans:          1,
			PlanRef:             planRef,
			RunID:               runID,
			Status:              "planned",
			Steps: []CapabilityBranchStep{{
				AllowedTools: []string{"service_status_lookup"},
				Capability:   "campus_services",
				PayloadKind:  "service_status_lookup",
				StepID:       "capability:campus_services:service_status_lookup",
				ToolName:     "service_status_lookup",
				WorkerRole:   "activity-worker-campus-services",
			}},
			ToolName:     "service_status_lookup",
			WorkerRole:   "activity-worker-campus-services",
			WorkflowMode: "single_step",
		}, nil)
	env.OnActivity(
		ExecuteTypedToolActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecuteTypedToolActivityInput) bool {
			return input.RunID == runID && input.ToolName == "service_status_lookup"
		}),
	).Return(ExecuteTypedToolActivityOutput{}, errors.New("service status unavailable")).Once()
	env.OnActivity(
		PlanReplanActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PlanReplanActivityInput) bool {
			return input.RunID == runID &&
				input.ReplanCount == 1 &&
				input.Reason == "typed_tool_failed" &&
				input.PreviousPlanRef == planRef &&
				len(input.AllowedCapabilities) == 1 &&
				input.AllowedCapabilities[0] == "campus_services" &&
				len(input.AllowedTools) == 1 &&
				input.AllowedTools[0] == "service_status_lookup"
		}),
	).Return(PlanReplanActivityOutput{
		AllowedCapabilities: []string{"campus_services"},
		NewPlanRef:          replanRef,
		RunID:               runID,
		Status:              "planned",
		Steps: []CapabilityBranchStep{{
			AllowedTools: []string{"service_status_lookup"},
			Capability:   "campus_services",
			PayloadKind:  "service_status_lookup",
			StepID:       "capability:campus_services:service_status_lookup:retry",
			ToolName:     "service_status_lookup",
			WorkerRole:   "activity-worker-campus-services",
		}},
	}, nil)
	env.OnActivity(
		ExecuteTypedToolActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecuteTypedToolActivityInput) bool {
			return input.RunID == runID &&
				input.RoutePlanRef == replanRef &&
				input.ToolName == "service_status_lookup"
		}),
	).Return(ExecuteTypedToolActivityOutput{
		Capability:  "campus_services",
		ResultRef:   "projection://runs/" + runID + "/tools/service_status_lookup/retry",
		RunID:       runID,
		Status:      "completed",
		ToolName:    "service_status_lookup",
		PayloadKind: "service_status_lookup",
	}, nil).Once()
	env.OnActivity(WriteFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + runID + "/finalization",
			RunID:         runID,
			Status:        "completed",
		}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-replan-001",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "3f0a4a5f0d2ed0cecbfb4c72dc90653d4f484ba5856ea35f246fb3c3a37c78fe",
		RequestID:           "req-replan-001",
		RequestedCapability: "campus_services",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             "trace-replan-001",
		TurnID:              "turn-replan-001",
		WorkflowID:          "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowRejectsReplanThatExpandsCapability(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-replan-expand-001"

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).
		Return(MemoryRecallActivityOutput{RunID: runID, MemoryRef: "projection://runs/" + runID + "/memory/recall", Status: "completed"}, nil)
	env.OnActivity(PlanRouteActivityName, mock.Anything, mock.Anything).
		Return(PlanRouteActivityOutput{
			AllowedCapabilities: []string{"campus_services"},
			AllowedTools:        []string{"service_status_lookup"},
			Capability:          "campus_services",
			MaxReplans:          1,
			PlanRef:             "projection://runs/" + runID + "/plan/route",
			RunID:               runID,
			Status:              "planned",
			Steps: []CapabilityBranchStep{{
				AllowedTools: []string{"service_status_lookup"},
				Capability:   "campus_services",
				PayloadKind:  "service_status_lookup",
				StepID:       "capability:campus_services:service_status_lookup",
				ToolName:     "service_status_lookup",
				WorkerRole:   "activity-worker-campus-services",
			}},
			ToolName:     "service_status_lookup",
			WorkerRole:   "activity-worker-campus-services",
			WorkflowMode: "single_step",
		}, nil)
	env.OnActivity(ExecuteTypedToolActivityName, mock.Anything, mock.Anything).
		Return(ExecuteTypedToolActivityOutput{}, errors.New("service status unavailable")).Once()
	env.OnActivity(PlanReplanActivityName, mock.Anything, mock.Anything).
		Return(PlanReplanActivityOutput{
			AllowedCapabilities: []string{"knowledge"},
			NewPlanRef:          "projection://runs/" + runID + "/plan/replan/1",
			RunID:               runID,
			Status:              "planned",
			Steps: []CapabilityBranchStep{{
				Capability:  "knowledge",
				PayloadKind: "rag_request",
				StepID:      "capability:knowledge:rag_request",
				ToolName:    "retrieval.query",
				WorkerRole:  "activity-worker-knowledge",
			}},
		}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-replan-expand-001",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "3f0a4a5f0d2ed0cecbfb4c72dc90653d4f484ba5856ea35f246fb3c3a37c78fe",
		RequestID:           "req-replan-expand-001",
		RequestedCapability: "campus_services",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             "trace-replan-expand-001",
		TurnID:              "turn-replan-expand-001",
		WorkflowID:          "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err == nil || !strings.Contains(err.Error(), "replan expanded capability") {
		t.Fatalf("workflow error = %v, want replan expanded capability", err)
	}
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
