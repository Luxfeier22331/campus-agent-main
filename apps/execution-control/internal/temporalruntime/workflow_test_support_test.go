package temporalruntime

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
)

type Activities struct{}

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities) {
	env.RegisterActivityWithOptions(activities.MemoryRecallActivity, activity.RegisterOptions{Name: MemoryRecallActivityName})
	env.RegisterActivityWithOptions(
		activities.AppendConversationMemoryActivity,
		activity.RegisterOptions{Name: AppendConversationMemoryActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activity.RegisterOptions{Name: ExecutePrimaryAgentActivityName},
	)
	env.RegisterActivityWithOptions(activities.PlanRouteActivity, activity.RegisterOptions{Name: PlanRouteActivityName})
	env.RegisterActivityWithOptions(activities.PlanReplanActivity, activity.RegisterOptions{Name: PlanReplanActivityName})
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
	env.RegisterActivityWithOptions(
		activities.ExecuteAgentAsToolActivity,
		activity.RegisterOptions{Name: ExecuteAgentAsToolActivityName},
	)
	env.RegisterActivityWithOptions(activities.WriteFinalizationActivity, activity.RegisterOptions{Name: WriteFinalizationActivityName})
}

func newWorkflowTestEnvironment() *testsuite.TestWorkflowEnvironment {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	return env
}

func workflowTestInput(runID string) ToolExecutionWorkflowInput {
	return ToolExecutionWorkflowInput{
		ConversationID: "conv-" + runID,
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "d8a73157ce10cd94a91c2079fc9a92c8f9f42f71360e4de7b80bf2e7d5e75c5c",
		RequestID:      "req-" + runID,
		RequestedTool:  "knowledge_query",
		RunID:          runID,
		TaskQueue:      WorkflowTaskQueue,
		TraceID:        "trace-" + runID,
		TurnID:         "turn-" + runID,
		VisibleToolNames: []string{
			"knowledge_query",
		},
		WorkflowID: "campus-agent.chat." + runID,
	}
}

func expectWorkflowCompletedWithoutError(env *testsuite.TestWorkflowEnvironment) error {
	if !env.IsWorkflowCompleted() {
		return context.Canceled
	}
	return env.GetWorkflowError()
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

func (Activities) AppendConversationMemoryActivity(
	_ context.Context,
	input AppendConversationMemoryActivityInput,
) (AppendConversationMemoryActivityOutput, error) {
	return AppendConversationMemoryActivityOutput{
		AppendedMessageCount: 1,
		PayloadSHA256:        "memory-append-hash",
		RunID:                input.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
	}, nil
}

func (Activities) ExecutePrimaryAgentActivity(
	_ context.Context,
	input ExecutePrimaryAgentActivityInput,
) (ExecutePrimaryAgentActivityOutput, error) {
	return ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
		FinalOutput:    "你好，我是校园问答助手。",
		RunID:          input.RunID,
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil
}

func (Activities) PlanRouteActivity(
	_ context.Context,
	input PlanRouteActivityInput,
) (PlanRouteActivityOutput, error) {
	tool := input.RequestedTool
	if tool == "" {
		tool = "knowledge_query"
	}
	if tool == "transport_schedule_lookup" {
		return PlanRouteActivityOutput{
			AllowedToolTargets: []string{"transport_schedule_lookup"},
			AllowedTools:       []string{"transport_schedule_lookup"},
			PlanRef:            "projection://runs/" + input.RunID + "/plan/route",
			RunID:              input.RunID,
			Status:             "planned",
			ToolName:           "transport_schedule_lookup",
			ToolTarget:         "transport_schedule_lookup",
			TaskQueue:          ActivityTaskQueueCore,
			PayloadKind:        "transport_schedule_lookup",
		}, nil
	}
	return PlanRouteActivityOutput{
		AllowedToolTargets: []string{"knowledge_query"},
		AllowedTools:       []string{"knowledge_query"},
		PlanRef:            "projection://runs/" + input.RunID + "/plan/route",
		RunID:              input.RunID,
		Status:             "planned",
		ToolName:           "knowledge_query",
		ToolTarget:         "knowledge_query",
		TaskQueue:          ActivityTaskQueueKnowledge,
		PayloadKind:        "rag_request",
	}, nil
}

func (Activities) PlanReplanActivity(
	_ context.Context,
	input PlanReplanActivityInput,
) (PlanReplanActivityOutput, error) {
	return PlanReplanActivityOutput{
		AllowedToolTargets: append([]string{}, input.AllowedToolTargets...),
		NewPlanRef:         "projection://runs/" + input.RunID + "/plan/replan/default",
		RunID:              input.RunID,
		Status:             "planned",
		Steps: []ToolBranchStep{{
			AllowedTools: append([]string{}, input.AllowedTools...),
			PayloadKind:  "transport_schedule_lookup",
			StepID:       "tool:transport_schedule_lookup:replan",
			ToolName:     input.AllowedTools[0],
			ToolTarget:   input.AllowedToolTargets[0],
			TaskQueue:    ActivityTaskQueueCore,
		}},
	}, nil
}

func (Activities) ExecuteTypedToolActivity(
	_ context.Context,
	input ExecuteTypedToolActivityInput,
) (ExecuteTypedToolActivityOutput, error) {
	return ExecuteTypedToolActivityOutput{
		ResultRef:   "projection://runs/" + input.RunID + "/tools/" + input.ToolName,
		RunID:       input.RunID,
		Status:      "completed",
		ToolName:    input.ToolName,
		ToolTarget:  input.ToolTarget,
		PayloadKind: input.PayloadKind,
	}, nil
}

func (Activities) ExecuteAgentAsToolActivity(
	_ context.Context,
	input ExecuteAgentAsToolActivityInput,
) (ExecuteAgentAsToolActivityOutput, error) {
	return ExecuteAgentAsToolActivityOutput{
		AdmittedAgentID: input.AdmittedAgentID,
		ResultRef:       "projection://runs/" + input.RunID + "/agent-as-tool/" + input.StepID,
		RunID:           input.RunID,
		Status:          "completed",
		StepID:          input.StepID,
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
			input.RequestedTool == "knowledge_query"
	}
}

func planInputMatcher(runID string) func(PlanRouteActivityInput) bool {
	return func(input PlanRouteActivityInput) bool {
		return input.RunID == runID &&
			input.TraceID == "trace-workflow-001" &&
			input.PayloadSHA256 != "" &&
			input.RequestedTool == "knowledge_query"
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
