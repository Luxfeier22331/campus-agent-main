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

func TestCapabilityExecutionWorkflowExecutesPrimaryAgentBranch(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	agentResultRef := "projection://runs/run-workflow-001/agent/primary/result"
	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == "run-workflow-001" &&
				input.TraceID == "trace-workflow-001" &&
				input.RequestID == "req-workflow-001" &&
				input.RequestedCapability == ""
		}),
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
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == "run-workflow-001" &&
				input.TraceID == "trace-workflow-001" &&
				input.RequestID == "req-workflow-001" &&
				input.ConversationID == "conv-workflow-001" &&
				input.TurnID == "turn-workflow-001" &&
				input.RequestedCapability == "" &&
				len(input.MemoryProjectionRefs) == 1 &&
				input.MemoryProjectionRefs[0] == "projection://runs/run-workflow-001/memory/recall" &&
				len(input.VisibleCapabilities) == 3 &&
				input.VisibleCapabilities[0] == "knowledge" &&
				input.VisibleCapabilities[1] == "campus_services" &&
				input.VisibleCapabilities[2] == "notice"
		}),
	).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef:     agentResultRef,
			FinalOutput:        "你好，我是校园问答助手。",
			ProviderResponseID: "resp-primary-001",
			RunID:              "run-workflow-001",
			SDKTraceRef:        "trace://openai-agents/run-workflow-001",
			SelectedTools:      []string{},
			Status:             "completed",
			TerminalReason:     "answer_completed",
		},
		nil,
	)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == "run-workflow-001" &&
				input.TraceID == "trace-workflow-001" &&
				input.AgentResultRef == agentResultRef &&
				input.GroundingRef == "" &&
				input.SynthesisRef == "" &&
				input.ToolResultRef == ""
		}),
	).Return(
		WriteFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/run-workflow-001/finalization",
			RunID:         "run-workflow-001",
			Status:        "completed",
		},
		nil,
	)
	env.OnActivity(
		AppendConversationMemoryActivityName,
		mock.Anything,
		mock.MatchedBy(func(input AppendConversationMemoryActivityInput) bool {
			return input.RunID == "run-workflow-001" &&
				input.TraceID == "trace-workflow-001" &&
				input.RequestID == "req-workflow-001"
		}),
	).Return(
		AppendConversationMemoryActivityOutput{
			AppendedMessageCount: 2,
			PayloadSHA256:        "memory-append-hash",
			RunID:                "run-workflow-001",
			SchemaVersion:        "memory_conversation_append_result_v1",
			Status:               "completed",
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
	env.AssertNotCalled(t, PlanRouteActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, PlanRAGActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, ExecuteTypedToolActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowRunsKnowledgeGraphWhenPrimaryAgentSelectsKnowledge(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 1, 42, 0, 0, time.UTC)
	runID := "run-workflow-knowledge-001"
	traceID := "trace-workflow-knowledge-001"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"
	ragPlanRef := "projection://runs/" + runID + "/rag/plan"
	synthesisRef := "projection://runs/" + runID + "/synthesis/provider"
	groundingRef := "projection://runs/" + runID + "/grounding/verify"

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == runID && input.TraceID == traceID
		}),
	).Return(MemoryRecallActivityOutput{
		MemoryRef:           "projection://runs/" + runID + "/memory/recall",
		RunID:               runID,
		SelectedMemoryChars: 0,
		SelectedMemoryCount: 0,
		Status:              "completed",
	}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				len(input.VisibleCapabilities) == 3 &&
				input.VisibleCapabilities[0] == "knowledge"
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef:     agentResultRef,
		FinalOutput:        "",
		ProviderResponseID: "resp-primary-knowledge-001",
		RunID:              runID,
		SDKTraceRef:        "trace://openai-agents/" + runID,
		SelectedTools:      []string{"knowledge_query"},
		Status:             "completed",
		TerminalReason:     "tool_selected",
	}, nil)
	env.OnActivity(
		PlanRAGActivityName,
		mock.Anything,
		mock.MatchedBy(func(input PlanRAGActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.WorkflowPlanRef == agentResultRef &&
				len(input.DependencyResultRefs) == 1 &&
				input.DependencyResultRefs[0] == agentResultRef
		}),
	).Return(PlanRAGActivityOutput{
		PlanRef: ragPlanRef,
		RunID:   runID,
		Status:  "completed",
	}, nil)
	env.OnActivity(
		RetrieveIndexedLookupActivityName,
		mock.Anything,
		mock.MatchedBy(func(input RetrieveIndexedLookupActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.RAGPlanRef == ragPlanRef
		}),
	).Return(RetrieveIndexedLookupActivityOutput{
		LookupRef: "projection://runs/" + runID + "/retrieval/lookup",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		ExpandOrRescueRetrievalActivityName,
		mock.Anything,
		mock.Anything,
	).Return(ExpandOrRescueRetrievalActivityOutput{
		LookupRef: "projection://runs/" + runID + "/retrieval/lookup",
		RescueRef: "projection://runs/" + runID + "/retrieval/rescue",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		SelectEvidenceActivityName,
		mock.Anything,
		mock.Anything,
	).Return(SelectEvidenceActivityOutput{
		EvidenceRef: "projection://runs/" + runID + "/evidence/select",
		RunID:       runID,
		Status:      "completed",
	}, nil)
	env.OnActivity(
		SynthesizeRAGAnswerActivityName,
		mock.Anything,
		mock.MatchedBy(func(input SynthesizeRAGAnswerActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.RAGPlanRef == ragPlanRef &&
				input.EvidenceRef == "projection://runs/"+runID+"/evidence/select"
		}),
	).Return(SynthesizeRAGAnswerActivityOutput{
		RunID:        runID,
		Status:       "completed",
		SynthesisRef: synthesisRef,
	}, nil)
	env.OnActivity(
		VerifyGroundingActivityName,
		mock.Anything,
		mock.MatchedBy(func(input VerifyGroundingActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.EvidenceRef == "projection://runs/"+runID+"/evidence/select" &&
				input.SynthesisRef == synthesisRef
		}),
	).Return(VerifyGroundingActivityOutput{
		GroundingRef: groundingRef,
		RunID:        runID,
		Status:       "completed",
	}, nil)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.AgentResultRef == "" &&
				input.SynthesisRef == synthesisRef &&
				input.GroundingRef == groundingRef
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID: "conv-workflow-knowledge-001",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:      "req-workflow-knowledge-001",
		RunID:          runID,
		TaskQueue:      WorkflowTaskQueue,
		TraceID:        traceID,
		TurnID:         "turn-workflow-knowledge-001",
		WorkflowID:     "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowRetriesPrimaryAgentWithinVisibleToolsOnce(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-workflow-primary-replan-001"
	traceID := "trace-workflow-primary-replan-001"
	firstAgentResultRef := "projection://runs/" + runID + "/agent/primary/result/1"
	secondAgentResultRef := "projection://runs/" + runID + "/agent/primary/result/2"
	completedAt := time.Date(2026, 6, 12, 12, 30, 0, 0, time.UTC)

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				len(input.VisibleCapabilities) == 1 &&
				input.VisibleCapabilities[0] == "campus_services"
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: firstAgentResultRef,
		FinalOutput:    "当前工具调用失败，准备重试。",
		RunID:          runID,
		SelectedTools:  []string{"transport_schedule_lookup"},
		Status:         "failed",
		TerminalReason: "agent_runtime_failed",
		ToolResults: []AgentToolResult{{
			Capability:      "campus_services",
			FailCloseReason: "tool_handler_failed",
			PayloadKind:     "transport_schedule_lookup",
			ResultRef:       "agent-runtime://" + runID + "/tools/transport_schedule_lookup/1",
			Status:          "failed",
			ToolName:        "transport_schedule_lookup",
		}},
	}, nil).Once()
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				len(input.VisibleCapabilities) == 1 &&
				input.VisibleCapabilities[0] == "campus_services"
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: secondAgentResultRef,
		FinalOutput:    "今晚六点班车当前投影可用。",
		RunID:          runID,
		SelectedTools:  []string{"transport_schedule_lookup"},
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil).Once()
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.AgentResultRef == secondAgentResultRef
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-workflow-primary-replan-001",
		Namespace:           "campus-agent-test",
		RequestID:           "req-workflow-primary-replan-001",
		RequestedCapability: "campus_services",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             traceID,
		TurnID:              "turn-workflow-primary-replan-001",
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

func TestCapabilityExecutionWorkflowDoesNotRetryPrimaryAgentDeterministicFailClose(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-workflow-primary-no-replan-001"
	traceID := "trace-workflow-primary-no-replan-001"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"
	completedAt := time.Date(2026, 6, 12, 12, 35, 0, 0, time.UTC)

	env.OnActivity(MemoryRecallActivityName, mock.Anything, mock.Anything).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID && len(input.VisibleCapabilities) == 1
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: agentResultRef,
		FinalOutput:    "当前状态无法可靠确认。",
		RunID:          runID,
		SelectedTools:  []string{"transport_schedule_lookup"},
		Status:         "completed",
		TerminalReason: "unsupported_by_evidence",
		ToolResults: []AgentToolResult{{
			Capability:      "campus_services",
			FailCloseReason: "current_state_unverifiable",
			PayloadKind:     "transport_schedule_lookup",
			ResultRef:       "agent-runtime://" + runID + "/tools/transport_schedule_lookup/1",
			Status:          "completed",
			ToolName:        "transport_schedule_lookup",
		}},
	}, nil).Once()
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.TraceID == traceID &&
				input.AgentResultRef == agentResultRef
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil).Once()

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-workflow-primary-no-replan-001",
		Namespace:           "campus-agent-test",
		RequestID:           "req-workflow-primary-no-replan-001",
		RequestedCapability: "campus_services",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             traceID,
		TurnID:              "turn-workflow-primary-no-replan-001",
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

func TestCapabilityExecutionWorkflowDoesNotTreatRetrievalQueryAsPrimaryAgentSignal(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	runID := "run-retrieval-query-not-primary-signal"
	traceID := "trace-retrieval-query-not-primary-signal"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == runID && input.TraceID == traceID
		}),
	).Return(MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + runID + "/memory/recall",
		RunID:     runID,
		Status:    "completed",
	}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: agentResultRef,
		FinalOutput:    "agent selected an invalid raw retrieval tool",
		RunID:          runID,
		SelectedTools:  []string{"retrieval.query"},
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.AgentResultRef == agentResultRef &&
				input.SynthesisRef == "" &&
				input.GroundingRef == ""
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   time.Date(2026, 6, 4, 1, 50, 0, 0, time.UTC),
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID: "conv-" + runID,
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:      "req-" + runID,
		RunID:          runID,
		TaskQueue:      WorkflowTaskQueue,
		TraceID:        traceID,
		TurnID:         "turn-" + runID,
		WorkflowID:     "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertNotCalled(t, PlanRAGActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowLimitsVisibleCapabilitiesForExplicitCampusServices(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 2, 3, 4, 0, time.UTC)
	agentResultRef := "projection://runs/run-campus-services-001/agent/primary/result"
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
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.RequestedCapability == "campus_services" &&
				len(input.VisibleCapabilities) == 1 &&
				input.VisibleCapabilities[0] == "campus_services"
		}),
	).Return(
		ExecutePrimaryAgentActivityOutput{
			AgentResultRef: agentResultRef,
			FinalOutput:    "当前班车正常运行。",
			RunID:          "run-campus-services-001",
			SelectedTools:  []string{"service_status_lookup"},
			Status:         "completed",
			TerminalReason: "answer_completed",
		},
		nil,
	)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == "run-campus-services-001" &&
				input.AgentResultRef == agentResultRef &&
				input.ToolResultRef == "" &&
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
	env.AssertNotCalled(t, PlanRouteActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, ExecuteTypedToolActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, PlanRAGActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestCapabilityExecutionWorkflowLimitsVisibleCapabilitiesForExplicitNotice(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	completedAt := time.Date(2026, 6, 4, 3, 4, 5, 0, time.UTC)
	runID := "run-notice-primary-001"
	traceID := "trace-notice-primary-001"
	agentResultRef := "projection://runs/" + runID + "/agent/primary/result"

	env.OnActivity(
		MemoryRecallActivityName,
		mock.Anything,
		mock.MatchedBy(func(input MemoryRecallActivityInput) bool {
			return input.RunID == runID && input.RequestedCapability == "notice"
		}),
	).Return(MemoryRecallActivityOutput{
		MemoryRef:           "projection://runs/" + runID + "/memory/recall",
		RunID:               runID,
		SelectedMemoryChars: 0,
		SelectedMemoryCount: 0,
		Status:              "completed",
	}, nil)
	env.OnActivity(
		ExecutePrimaryAgentActivityName,
		mock.Anything,
		mock.MatchedBy(func(input ExecutePrimaryAgentActivityInput) bool {
			return input.RunID == runID &&
				input.RequestedCapability == "notice" &&
				len(input.VisibleCapabilities) == 1 &&
				input.VisibleCapabilities[0] == "notice"
		}),
	).Return(ExecutePrimaryAgentActivityOutput{
		AgentResultRef: agentResultRef,
		FinalOutput:    "已找到相关通知。",
		RunID:          runID,
		SelectedTools:  []string{"campus_notice_discover"},
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil)
	env.OnActivity(
		WriteFinalizationActivityName,
		mock.Anything,
		mock.MatchedBy(func(input WriteFinalizationActivityInput) bool {
			return input.RunID == runID &&
				input.AgentResultRef == agentResultRef &&
				input.ToolResultRef == ""
		}),
	).Return(WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: "projection://runs/" + runID + "/finalization",
		RunID:         runID,
		Status:        "completed",
	}, nil)

	env.ExecuteWorkflow(CapabilityExecutionWorkflow, CapabilityExecutionWorkflowInput{
		ConversationID:      "conv-notice-primary-001",
		Namespace:           "campus-agent-test",
		PayloadSHA256:       "3f0a4a5f0d2ed0cecbfb4c72dc90653d4f484ba5856ea35f246fb3c3a37c78fe",
		RequestID:           "req-notice-primary-001",
		RequestedCapability: "notice",
		RunID:               runID,
		TaskQueue:           WorkflowTaskQueue,
		TraceID:             traceID,
		TurnID:              "turn-notice-primary-001",
		WorkflowID:          "campus-agent.chat." + runID,
	})

	if !env.IsWorkflowCompleted() {
		t.Fatal("workflow did not complete")
	}
	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertNotCalled(t, PlanRouteActivityName, mock.Anything, mock.Anything)
	env.AssertNotCalled(t, ExecuteTypedToolActivityName, mock.Anything, mock.Anything)
	env.AssertExpectations(t)
}

func TestWorkflowFailureAllowsReplanRejectsFailClosedTypedToolResult(t *testing.T) {
	allows := workflowFailureAllowsReplan(
		CapabilityBranchStep{
			Capability: "campus_services",
			ToolName:   "service_status_lookup",
		},
		errors.New("typed tool service_status_lookup fail_close_reason=current_state_unverifiable"),
	)
	if allows {
		t.Fatal("fail-closed typed tool result must not be replanned")
	}
}

func TestValidateReplanWithinBoundsRejectsExpandedCapability(t *testing.T) {
	err := validateReplanWithinBounds(
		PlanRouteActivityOutput{
			AllowedCapabilities: []string{"campus_services"},
			AllowedTools:        []string{"service_status_lookup"},
		},
		[]CapabilityBranchStep{{
			AllowedTools: []string{"service_status_lookup"},
			Capability:   "campus_services",
			ToolName:     "service_status_lookup",
		}},
		PlanReplanActivityOutput{
			AllowedCapabilities: []string{"knowledge"},
			NewPlanRef:          "projection://runs/run-replan-expand-001/plan/replan/1",
			Steps: []CapabilityBranchStep{{
				Capability: "knowledge",
				ToolName:   "retrieval.query",
			}},
		},
	)
	if err == nil || !strings.Contains(err.Error(), "replan expanded capability") {
		t.Fatalf("err = %v, want replan expanded capability", err)
	}
}

func TestWorkerRuntimeRequiresFinalizationActivities(t *testing.T) {
	_, err := NewWorkerRuntime(context.Background(), WorkerOptions{
		Address:                 "127.0.0.1:1",
		Namespace:               "campus-agent-test",
		WorkflowQueue:           WorkflowTaskQueue,
		ContextQueue:            ActivityTaskQueueContext,
		KnowledgePlanQueue:      ActivityTaskQueueKnowledgePlan,
		KnowledgeRetrievalQueue: ActivityTaskQueueKnowledgeRetrieval,
		KnowledgeSynthesisQueue: ActivityTaskQueueKnowledgeSynthesis,
		FinalizationQueue:       ActivityTaskQueueFinalization,
		ContextActivities:       &Activities{},
		AgentActivities:         &Activities{},
		KnowledgeActivities:     &Activities{},
		FinalizationActivities:  nil,
	})
	if err == nil {
		t.Fatal("expected missing finalization activities to fail")
	}
	if !strings.Contains(err.Error(), "temporal finalization activities are required") {
		t.Fatalf("error = %q", err.Error())
	}
}
