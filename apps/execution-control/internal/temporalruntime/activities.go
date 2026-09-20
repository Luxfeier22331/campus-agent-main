package temporalruntime

import "context"

type ContextActivities interface {
	AdvanceMemoryAppendActivity(context.Context, MemoryAppendWorkflowInput) (AppendConversationMemoryActivityOutput, error)
	FinalizeMemoryAppendActivity(context.Context, FinalizeMemoryAppendActivityInput) error
	AppendConversationMemoryActivity(
		context.Context,
		AppendConversationMemoryActivityInput,
	) (AppendConversationMemoryActivityOutput, error)
	ExecutePersonalMemoryCommandActivity(
		context.Context,
		PersonalMemoryCommandRequest,
	) (PersonalMemoryCommandActivityOutput, error)
	FinalizePersonalMemoryCommandReceiptActivity(
		context.Context,
		FinalizePersonalMemoryCommandReceiptActivityInput,
	) (PersonalMemoryCommandActivityOutput, error)
	WritePersonalMemoryCommandResultActivity(
		context.Context,
		PersonalMemoryCommandActivityOutput,
	) error
}

type WorkflowActivities interface {
	SolveTaskActivity(
		context.Context,
		SolveTaskActivityInput,
	) (WorkflowOperationActivityOutput, error)
	ExecuteTaskStepActivity(
		context.Context,
		ExecuteTaskStepActivityInput,
	) (WorkflowOperationActivityOutput, error)
	ReplanTaskActivity(
		context.Context,
		ReplanTaskActivityInput,
	) (WorkflowOperationActivityOutput, error)
	SynthesizeAnswerActivity(
		context.Context,
		SynthesizeAnswerActivityInput,
	) (WorkflowOperationActivityOutput, error)
}

type FinalizationActivities interface {
	FinalizeExecutionCancellationActivity(
		context.Context,
		FinalizeExecutionCancellationActivityInput,
	) (FinalizeExecutionCancellationActivityOutput, error)
	FinalizeExecutionFailureActivity(
		context.Context,
		FinalizeExecutionFailureActivityInput,
	) (FinalizeExecutionFailureActivityOutput, error)
	WriteWorkflowFinalizationActivity(
		context.Context,
		WriteWorkflowFinalizationActivityInput,
	) (WorkflowFinalizationActivityOutput, error)
}
