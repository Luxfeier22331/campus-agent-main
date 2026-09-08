package finalization

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

func (s *Adapter) FinalizeExecutionFailure(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	if strings.TrimSpace(input.RequestID) == "" || input.FailedAt.IsZero() {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution failure finalizer identity is invalid",
			"execution_failure_finalizer_invalid",
			nil,
		)
	}
	projection, validStage := TemporalFailureProjectionForStage(input)
	if !validStage || activityprojection.BoundedTemporalFailureKind(input.FailureKind) != strings.TrimSpace(input.FailureKind) {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution failure finalizer payload is invalid",
			"execution_failure_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.RunProjectionStore == nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.EnsureTemporalActivityOwnsRootExecution(ctx, input.RequestID, false); err != nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, err
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(input.RequestID))
	if err != nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"execution_failure_finalizer_state_unavailable",
			err,
			errors.Is(err, execution.ErrDurableRunNotFound),
		)
	}
	if run.Status != execution.DurableRunStatusFailed && activityprojection.TemporalRunTerminal(run.Status) {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution run reached a conflicting terminal state",
			"execution_failure_terminal_conflict",
			nil,
		)
	}
	cause := FixedTemporalFailureError(input.FailureKind)
	projection.FailedAt = input.FailedAt
	projection.FailureKind = input.FailureKind
	failedRun, finalizeErr := s.FailTemporalRun(ctx, run, projection, cause)
	if finalizeErr != nil {
		var applicationError *temporal.ApplicationError
		if errors.As(finalizeErr, &applicationError) {
			return temporalruntime.FinalizeExecutionFailureActivityOutput{}, finalizeErr
		}
		failureKind := "execution_failure_finalizer_failed"
		if errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict) {
			failureKind = "execution_failure_terminal_conflict"
		}
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			failureKind,
			finalizeErr,
			errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict),
		)
	}
	return FinalizedExecutionFailureOutput(failedRun), nil
}

func TemporalFailureProjectionForStage(
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (activityprojection.TemporalStepFailureProjection, bool) {
	stage := strings.TrimSpace(input.Stage)
	switch {
	case stage == "solve.initial":
		return activityprojection.TemporalStepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "solver",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		}, true
	case strings.HasPrefix(stage, "task.step."):
		return activityprojection.TemporalStepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "executor",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		}, true
	case strings.HasPrefix(stage, "solve.replan."):
		return activityprojection.TemporalStepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "replanner",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		}, true
	case stage == "answer.synthesize":
		return activityprojection.TemporalStepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "synthesizer",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		}, true
	case stage == "finalization.write":
		return activityprojection.TemporalStepFailureProjection{
			ProjectionRef: activityprojection.TemporalProjectionRef(input.RequestID, "finalization/write"),
			ResultKind:    "activity_failure",
			StepID:        "finalization.write",
			StepKind:      "finalization",
			TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		}, true
	default:
		return activityprojection.TemporalStepFailureProjection{}, false
	}
}

func FinalizedExecutionFailureOutput(run execution.DurableRun) temporalruntime.FinalizeExecutionFailureActivityOutput {
	return temporalruntime.FinalizeExecutionFailureActivityOutput{
		CompletedAt: run.CompletedAt,
		RequestID:   run.RequestID,
		Status:      string(run.Status),
	}
}
