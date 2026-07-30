package temporalruntime

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"go.temporal.io/sdk/activity"
)

type Activities struct{}

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities) {
	env.RegisterActivityWithOptions(
		activities.AppendConversationMemoryActivity,
		activity.RegisterOptions{Name: AppendConversationMemoryActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.PrepareGroundingContextActivity,
		activity.RegisterOptions{Name: PrepareGroundingContextActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activity.RegisterOptions{Name: ExecutePrimaryAgentActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.WriteFinalizationActivity,
		activity.RegisterOptions{Name: WriteFinalizationActivityName},
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
		activities.PurgePersonalMemoryTracesActivity,
		activity.RegisterOptions{Name: PurgePersonalMemoryTracesActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.VerifyPersonalMemoryTracesActivity,
		activity.RegisterOptions{Name: VerifyPersonalMemoryTracesActivityName},
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

func (Activities) PrepareGroundingContextActivity(
	_ context.Context,
	input PrepareGroundingContextActivityInput,
) (PrepareGroundingContextActivityOutput, error) {
	return PrepareGroundingContextActivityOutput{
		GroundingContext:    GroundingContext{RunID: input.RunID},
		GroundingContextRef: "projection://runs/" + input.RunID + "/grounding/context",
		PayloadSHA256:       "sha256:0000000000000000000000000000000000000000000000000000000000000000",
		RunID:               input.RunID,
		Status:              "empty",
	}, nil
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
	return FinalizeExecutionCancellationActivityOutput{RunID: input.RunID, Status: "canceled"}, nil
}

func (Activities) ExecutePersonalMemoryCommandActivity(
	_ context.Context,
	input memoryruntime.PersonalMemoryCommandRequest,
) (PersonalMemoryCommandActivityOutput, error) {
	return PersonalMemoryCommandActivityOutput{
		CommandID: input.CommandID,
		Status:    "succeeded",
	}, nil
}

func (Activities) PurgePersonalMemoryTracesActivity(
	context.Context,
	PersonalMemoryTraceMaintenanceActivityInput,
) (PersonalMemoryTraceMaintenanceActivityOutput, error) {
	return PersonalMemoryTraceMaintenanceActivityOutput{}, nil
}

func (Activities) VerifyPersonalMemoryTracesActivity(
	context.Context,
	PersonalMemoryTraceMaintenanceActivityInput,
) (PersonalMemoryTraceMaintenanceActivityOutput, error) {
	return PersonalMemoryTraceMaintenanceActivityOutput{}, nil
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
		PayloadSHA256:        "sha256:memory-append",
		RunID:                input.RunID,
		SchemaVersion:        "memory_conversation_append_result_v2",
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
		TerminalEnvelope: map[string]any{
			"answer_text": "你好，我是校园问答助手。",
			"kind":        "answer",
		},
		TerminalReason: "answer_completed",
	}, nil
}

func (Activities) WriteFinalizationActivity(
	_ context.Context,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	return WriteFinalizationActivityOutput{
		CompletedAt:   time.Now().UTC(),
		ProjectionRef: "projection://runs/" + input.RunID + "/finalization/write",
		RunID:         input.RunID,
		Status:        "completed",
	}, nil
}
