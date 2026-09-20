package temporalruntime

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

type Activities struct{}

const workflowTestGoal = "查询并整理校园信息"

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities, asyncAppend ...bool) {
	// These scenarios also guard replay of pre-async histories. The new branch
	// and background workflow have dedicated tests in workflow_memory_append_test.
	if workflowEnv, ok := env.(*testsuite.TestWorkflowEnvironment); ok && (len(asyncAppend) == 0 || !asyncAppend[0]) {
		workflowEnv.OnGetVersion(memoryAppendVersion, workflow.DefaultVersion, 1).Return(workflow.DefaultVersion).Maybe()
	}
	env.RegisterActivityWithOptions(activities.AdvanceMemoryAppendActivity, activity.RegisterOptions{Name: AdvanceMemoryAppendActivityName})
	env.RegisterActivityWithOptions(activities.FinalizeMemoryAppendActivity, activity.RegisterOptions{Name: FinalizeMemoryAppendActivityName})
	env.RegisterActivityWithOptions(
		activities.AppendConversationMemoryActivity,
		activity.RegisterOptions{Name: AppendConversationMemoryActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.SolveTaskActivity,
		activity.RegisterOptions{Name: SolveTaskActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecuteTaskStepActivity,
		activity.RegisterOptions{Name: ExecuteTaskStepActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ReplanTaskActivity,
		activity.RegisterOptions{Name: ReplanTaskActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.SynthesizeAnswerActivity,
		activity.RegisterOptions{Name: SynthesizeAnswerActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.WriteWorkflowFinalizationActivity,
		activity.RegisterOptions{Name: WriteWorkflowFinalizationActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.FinalizeExecutionCancellationActivity,
		activity.RegisterOptions{Name: FinalizeExecutionCancellationActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecutePersonalMemoryCommandActivity,
		activity.RegisterOptions{Name: ExecutePersonalMemoryCommandActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.FinalizePersonalMemoryCommandReceiptActivity,
		activity.RegisterOptions{Name: FinalizePersonalMemoryCommandReceiptActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.FinalizeExecutionFailureActivity,
		activity.RegisterOptions{Name: FinalizeExecutionFailureActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.WritePersonalMemoryCommandResultActivity,
		activity.RegisterOptions{Name: WritePersonalMemoryCommandResultActivityName},
	)
}

func (Activities) AdvanceMemoryAppendActivity(_ context.Context, input MemoryAppendWorkflowInput) (AppendConversationMemoryActivityOutput, error) {
	return AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil
}

func (Activities) FinalizePersonalMemoryCommandReceiptActivity(
	_ context.Context,
	input FinalizePersonalMemoryCommandReceiptActivityInput,
) (PersonalMemoryCommandActivityOutput, error) {
	return input.Result, nil
}

func (Activities) FinalizeExecutionFailureActivity(
	context.Context,
	FinalizeExecutionFailureActivityInput,
) (FinalizeExecutionFailureActivityOutput, error) {
	return FinalizeExecutionFailureActivityOutput{}, nil
}

func (Activities) FinalizeExecutionCancellationActivity(
	_ context.Context,
	input FinalizeExecutionCancellationActivityInput,
) (FinalizeExecutionCancellationActivityOutput, error) {
	return FinalizeExecutionCancellationActivityOutput{RequestID: input.RequestID, Status: "canceled"}, nil
}

func (Activities) ExecutePersonalMemoryCommandActivity(
	_ context.Context,
	input PersonalMemoryCommandRequest,
) (PersonalMemoryCommandActivityOutput, error) {
	return PersonalMemoryCommandActivityOutput{
		CommandID: input.CommandID,
		Status:    "succeeded",
	}, nil
}

func (Activities) WritePersonalMemoryCommandResultActivity(
	context.Context,
	PersonalMemoryCommandActivityOutput,
) error {
	return nil
}

func (Activities) AppendConversationMemoryActivity(
	_ context.Context,
	input AppendConversationMemoryActivityInput,
) (AppendConversationMemoryActivityOutput, error) {
	return AppendConversationMemoryActivityOutput{
		AppendedMessageCount: 1,
		RequestID:            input.RequestID,
		SchemaVersion:        "memory_conversation_append_result_v3",
		Status:               "completed",
	}, nil
}

func (Activities) SolveTaskActivity(
	_ context.Context,
	input SolveTaskActivityInput,
) (WorkflowOperationActivityOutput, error) {
	step := WorkflowTaskPlanStep{
		ID:               "step.lookup",
		Objective:        workflowTestGoal,
		CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
		DependsOn:        []string{},
	}
	return WorkflowOperationActivityOutput{
		Operation:    WorkflowOperationSolve,
		SolveOutcome: "plan",
		Plan: &WorkflowTaskPlan{
			SchemaVersion: "task_plan.v1",
			Goal:          workflowTestGoal,
			Steps:         []WorkflowTaskPlanStep{step},
		},
		RequestID: input.RequestID,
		Status:    "completed",
	}, nil
}

func (Activities) ExecuteTaskStepActivity(
	_ context.Context,
	input ExecuteTaskStepActivityInput,
) (WorkflowOperationActivityOutput, error) {
	completed := WorkflowCompletedStep{
		Step:           input.Step,
		ExecutionIndex: len(input.CompletedSteps) + 1,
		Summary:        "已完成步骤。",
		Evidence:       []WorkflowEvidence{},
		SourceAttempts: []WorkflowSourceAttempt{{Source: input.Step.CandidateSources[0], Status: "completed"}},
	}
	return WorkflowOperationActivityOutput{
		Operation:      WorkflowOperationExecuteStep,
		RemainingFacts: completed.RemainingFacts,
		RequestID:      input.RequestID,
		Status:         "completed",
		FinalOutput:    completed.Summary,
		SourceAttempts: append([]WorkflowSourceAttempt{}, completed.SourceAttempts...),
		Evidence:       []WorkflowEvidence{},
	}, nil
}

func (Activities) ReplanTaskActivity(
	_ context.Context,
	input ReplanTaskActivityInput,
) (WorkflowOperationActivityOutput, error) {
	return WorkflowOperationActivityOutput{
		Operation: WorkflowOperationReplan,
		Replan: &WorkflowTaskReplan{
			SchemaVersion:  "task_replan.v3",
			Decision:       "continue",
			Reason:         "继续执行已规划步骤。",
			RemainingSteps: append([]WorkflowTaskPlanStep{}, input.RemainingSteps...),
		},
		RequestID: input.RequestID,
		Status:    "completed",
	}, nil
}

func (Activities) SynthesizeAnswerActivity(
	_ context.Context,
	input SynthesizeAnswerActivityInput,
) (WorkflowOperationActivityOutput, error) {
	return WorkflowOperationActivityOutput{
		Operation:   WorkflowOperationSynthesize,
		RequestID:   input.RequestID,
		Status:      "completed",
		FinalOutput: "这是合成后的校园信息答案。",
		Evidence:    append([]WorkflowEvidence{}, input.Evidence...),
	}, nil
}

func (Activities) WriteWorkflowFinalizationActivity(
	_ context.Context,
	input WriteWorkflowFinalizationActivityInput,
) (WorkflowFinalizationActivityOutput, error) {
	return WorkflowFinalizationActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RequestID + "/answer/synthesize/result",
		RequestID:     input.RequestID,
		Status:        "completed",
	}, nil
}

func validToolExecutionWorkflowInput(requestID string) ToolExecutionWorkflowInput {
	return ToolExecutionWorkflowInput{
		ConversationID: "conversation-" + requestID,
		RequestID:      requestID,
		AdmissionSnapshot: AgentAdmissionSnapshot{
			AgentCapabilities: AgentCapabilitiesSnapshot{
				SchemaVersion:            "agent_capabilities.v1",
				HostedWebSearch:          true,
				VisibleFunctionToolNames: []string{"campus_search", "personal_memory_recall"},
			},
			AgentBudget: AgentRuntimeBudgetSnapshot{
				MaxFunctionToolCalls: 8,
				MaxModelTurns:        8,
				MaxPlanSteps:         8,
				MaxReplans:           4,
				SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
			},
		},
	}
}

func (Activities) FinalizeMemoryAppendActivity(context.Context, FinalizeMemoryAppendActivityInput) error {
	return nil
}
