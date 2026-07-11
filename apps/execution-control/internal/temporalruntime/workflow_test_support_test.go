package temporalruntime

import (
	"context"
	"time"

	"go.temporal.io/sdk/activity"
)

type Activities struct{}

type workflowTestActivityRegistrar interface {
	RegisterActivityWithOptions(activity any, options activity.RegisterOptions)
}

func registerWorkflowTestActivities(env workflowTestActivityRegistrar, activities *Activities) {
	env.RegisterActivityWithOptions(
		activities.MemoryRecallActivity,
		activity.RegisterOptions{Name: MemoryRecallActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.AppendConversationMemoryActivity,
		activity.RegisterOptions{Name: AppendConversationMemoryActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.ExecutePrimaryAgentActivity,
		activity.RegisterOptions{Name: ExecutePrimaryAgentActivityName},
	)
	env.RegisterActivityWithOptions(
		activities.WriteFinalizationActivity,
		activity.RegisterOptions{Name: WriteFinalizationActivityName},
	)
}

func (Activities) MemoryRecallActivity(
	_ context.Context,
	input MemoryRecallActivityInput,
) (MemoryRecallActivityOutput, error) {
	return MemoryRecallActivityOutput{
		MemoryRef: "projection://runs/" + input.RunID + "/memory/recall",
		RunID:     input.RunID,
		Status:    "completed",
	}, nil
}

func (Activities) AppendConversationMemoryActivity(
	_ context.Context,
	input AppendConversationMemoryActivityInput,
) (AppendConversationMemoryActivityOutput, error) {
	return AppendConversationMemoryActivityOutput{
		AppendedMessageCount: 1,
		PayloadSHA256:        "sha256:memory-append",
		RunID:                input.RunID,
		SchemaVersion:        "memory_conversation_append_result_v1",
		Status:               "completed",
	}, nil
}

func (Activities) MemoryOperationStatusActivity(
	_ context.Context,
	_ MemoryOperationStatusActivityInput,
) (MemoryOperationStatusActivityOutput, error) {
	return MemoryOperationStatusActivityOutput{}, nil
}

func (Activities) MemoryReflectActivity(
	_ context.Context,
	_ MemoryReflectActivityInput,
) (MemoryReflectActivityOutput, error) {
	return MemoryReflectActivityOutput{}, nil
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
