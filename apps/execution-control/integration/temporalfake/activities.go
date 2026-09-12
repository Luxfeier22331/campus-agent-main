package temporalfake

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
)

// Activities supplies deterministic provider responses for real Temporal tests.
// HTTP integration overrides the finalizers that write its run projections.
type Activities struct{}

const workflowTestGoal = "查询并整理校园信息"

func (Activities) FinalizePersonalMemoryCommandReceiptActivity(
	_ context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return input.Result, nil
}

func (Activities) FinalizeExecutionFailureActivity(
	_ context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return temporalruntime.FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, CompletedAt: input.FailedAt, Status: "failed"}, nil
}

func (Activities) FinalizeExecutionCancellationActivity(
	_ context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return temporalruntime.FinalizeExecutionCancellationActivityOutput{RequestID: input.RequestID, Status: "canceled"}, nil
}

func (Activities) ExecutePersonalMemoryCommandActivity(
	_ context.Context,
	input temporalruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return temporalruntime.PersonalMemoryCommandActivityOutput{
		CommandID: input.CommandID,
		Status:    "succeeded",
	}, nil
}

func (Activities) WritePersonalMemoryCommandResultActivity(
	context.Context,
	temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	return nil
}

func (Activities) AppendConversationMemoryActivity(
	_ context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: 1,
		RequestID:            input.RequestID,
		SchemaVersion:        "memory_conversation_append_result_v3",
		Status:               "completed",
	}, nil
}

func (Activities) SolveTaskActivity(
	_ context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	step := temporalruntime.WorkflowTaskPlanStep{
		ID:               "step.lookup",
		Objective:        workflowTestGoal,
		CandidateSources: []temporalruntime.WorkflowSource{temporalruntime.WorkflowSourceCampusSearch},
		DependsOn:        []string{},
	}
	return temporalruntime.WorkflowOperationActivityOutput{
		Operation:    temporalruntime.WorkflowOperationSolve,
		SolveOutcome: "plan",
		Plan: &temporalruntime.WorkflowTaskPlan{
			SchemaVersion: "task_plan.v1",
			Goal:          workflowTestGoal,
			Steps:         []temporalruntime.WorkflowTaskPlanStep{step},
		},
		RequestID: input.RequestID,
		Status:    "completed",
	}, nil
}

func (Activities) ExecuteTaskStepActivity(
	_ context.Context,
	input temporalruntime.ExecuteTaskStepActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	completed := temporalruntime.WorkflowCompletedStep{
		Step:           input.Step,
		ExecutionIndex: len(input.CompletedSteps) + 1,
		Summary:        "已完成步骤。",
		RemainingFacts: []string{},
		Evidence: []temporalruntime.WorkflowEvidence{{
			SchemaVersion: "workflow_evidence.v1",
			ID:            "evidence.campus",
			Source:        temporalruntime.WorkflowSourceCampusSearch,
			Title:         "校园资料",
			Excerpt:       "校园服务指南",
			CitationIndex: 1,
		}},
		SourceAttempts: []temporalruntime.WorkflowSourceAttempt{{Source: input.Step.CandidateSources[0], Status: "matched"}},
	}
	return temporalruntime.WorkflowOperationActivityOutput{
		Operation:      temporalruntime.WorkflowOperationExecuteStep,
		RemainingFacts: completed.RemainingFacts,
		RequestID:      input.RequestID,
		Status:         "completed",
		FinalOutput:    completed.Summary,
		SourceAttempts: append([]temporalruntime.WorkflowSourceAttempt{}, completed.SourceAttempts...),
		Evidence:       append([]temporalruntime.WorkflowEvidence{}, completed.Evidence...),
	}, nil
}

func (Activities) ReplanTaskActivity(
	_ context.Context,
	input temporalruntime.ReplanTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return temporalruntime.WorkflowOperationActivityOutput{
		Operation: temporalruntime.WorkflowOperationReplan,
		Replan: &temporalruntime.WorkflowTaskReplan{
			SchemaVersion:  "task_replan.v3",
			Decision:       "continue",
			Reason:         "继续执行已规划步骤。",
			RemainingSteps: append([]temporalruntime.WorkflowTaskPlanStep{}, input.RemainingSteps...),
		},
		RequestID: input.RequestID,
		Status:    "completed",
	}, nil
}

func (Activities) SynthesizeAnswerActivity(
	_ context.Context,
	input temporalruntime.SynthesizeAnswerActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return temporalruntime.WorkflowOperationActivityOutput{
		Operation:      temporalruntime.WorkflowOperationSynthesize,
		RequestID:      input.RequestID,
		Status:         "completed",
		FinalOutput:    "这是合成后的校园信息答案。",
		SourceAttempts: input.SourceAttempts,
		Evidence:       append([]temporalruntime.WorkflowEvidence{}, input.Evidence...),
	}, nil
}

func (Activities) WriteWorkflowFinalizationActivity(
	_ context.Context,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return temporalruntime.WorkflowFinalizationActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RequestID + "/answer/synthesize/result",
		RequestID:     input.RequestID,
		Status:        "completed",
	}, nil
}

func WorkflowInput(requestID string) temporalruntime.ToolExecutionWorkflowInput {
	return temporalruntime.ToolExecutionWorkflowInput{
		ConversationID: "conversation-" + requestID,
		RequestID:      requestID,
		AdmissionSnapshot: temporalruntime.AgentAdmissionSnapshot{
			AgentCapabilities: temporalruntime.AgentCapabilitiesSnapshot{
				SchemaVersion:            "agent_capabilities.v1",
				HostedWebSearch:          true,
				VisibleFunctionToolNames: []string{"campus_search", "personal_memory_recall"},
			},
			AgentBudget: temporalruntime.AgentRuntimeBudgetSnapshot{
				MaxFunctionToolCalls: 8,
				MaxModelTurns:        8,
				MaxPlanSteps:         8,
				MaxReplans:           4,
				SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
			},
		},
	}
}

// WaitForCancellation models the heartbeat behavior of a running agent activity.
// Blocking on ctx.Done alone would make the test wait for heartbeat timeout.
func WaitForCancellation(ctx context.Context) error {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		activity.RecordHeartbeat(ctx)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
