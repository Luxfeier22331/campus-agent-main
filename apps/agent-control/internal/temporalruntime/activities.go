package temporalruntime

import "context"

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
