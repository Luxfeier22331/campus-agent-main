package temporaladapter

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
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
	projection, validStage := temporalFailureProjectionForStage(input)
	if !validStage || boundedTemporalFailureKind(input.FailureKind) != strings.TrimSpace(input.FailureKind) {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution failure finalizer payload is invalid",
			"execution_failure_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.runProjectionStore == nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, input.RequestID, false); err != nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, err
	}
	run, err := s.runProjectionStore.GetRun(ctx, strings.TrimSpace(input.RequestID))
	if err != nil {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, sanitizedTemporalApplicationError(
			"execution_failure_finalizer_state_unavailable",
			err,
			errors.Is(err, execution.ErrDurableRunNotFound),
		)
	}
	if run.Status != execution.DurableRunStatusFailed && temporalRunTerminal(run.Status) {
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution run reached a conflicting terminal state",
			"execution_failure_terminal_conflict",
			nil,
		)
	}
	cause := fixedTemporalFailureError(input.FailureKind)
	projection.FailedAt = input.FailedAt
	projection.FailureKind = input.FailureKind
	failedRun, finalizeErr := s.failTemporalRun(ctx, run, projection, cause)
	if finalizeErr != nil {
		var applicationError *temporal.ApplicationError
		if errors.As(finalizeErr, &applicationError) {
			return temporalruntime.FinalizeExecutionFailureActivityOutput{}, finalizeErr
		}
		failureKind := "execution_failure_finalizer_failed"
		if errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict) {
			failureKind = "execution_failure_terminal_conflict"
		}
		return temporalruntime.FinalizeExecutionFailureActivityOutput{}, sanitizedTemporalApplicationError(
			failureKind,
			finalizeErr,
			errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict),
		)
	}
	return finalizedExecutionFailureOutput(failedRun), nil
}

func temporalFailureProjectionForStage(
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalStepFailureProjection, bool) {
	switch strings.TrimSpace(input.Stage) {
	case "agent.primary":
		return temporalStepFailureProjection{
			ProjectionRef: temporalProjectionRef(input.RequestID, "agent/primary/result"),
			ResultKind:    "activity_failure",
			StepID:        "agent.primary",
			StepKind:      "agent",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		}, true
	case "finalization.write":
		return temporalStepFailureProjection{
			ProjectionRef: temporalProjectionRef(input.RequestID, "finalization/write"),
			ResultKind:    "activity_failure",
			StepID:        "finalization.write",
			StepKind:      "finalization",
			TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		}, true
	default:
		return temporalStepFailureProjection{}, false
	}
}

func finalizedExecutionFailureOutput(run execution.DurableRun) temporalruntime.FinalizeExecutionFailureActivityOutput {
	return temporalruntime.FinalizeExecutionFailureActivityOutput{
		CompletedAt: run.CompletedAt,
		RequestID:   run.RequestID,
		Status:      string(run.Status),
	}
}
