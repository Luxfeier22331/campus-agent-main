package finalizationactivity

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Handler interface {
	FinalizeExecutionCancellation(
		context.Context,
		temporalruntime.FinalizeExecutionCancellationActivityInput,
	) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error)
	FinalizeExecutionFailure(
		context.Context,
		temporalruntime.FinalizeExecutionFailureActivityInput,
	) (temporalruntime.FinalizeExecutionFailureActivityOutput, error)
	WriteFinalization(
		context.Context,
		temporalruntime.WriteFinalizationActivityInput,
	) (temporalruntime.WriteFinalizationActivityOutput, error)
}

type Activities struct {
	handler Handler
}

func New(handler Handler) Activities {
	return Activities{handler: handler}
}

func (activities Activities) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return activities.handler.FinalizeExecutionCancellation(ctx, input)
}

func (activities Activities) FinalizeExecutionFailureActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return activities.handler.FinalizeExecutionFailure(ctx, input)
}

func (activities Activities) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	return activities.handler.WriteFinalization(ctx, input)
}

var _ temporalruntime.FinalizationActivities = Activities{}
