package finalization

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
)

func (s *FinalizationService) FinalizeExecutionFailure(
	ctx context.Context,
	input executioncontract.FailureInput,
) (executioncontract.FailureOutput, error) {
	if strings.TrimSpace(input.RequestID) == "" || input.FailedAt.IsZero() {
		return executioncontract.FailureOutput{}, executionfailure.PermanentError(
			"execution failure finalizer identity is invalid",
			"execution_failure_finalizer_invalid",
			nil,
		)
	}
	projection, validStage := TemporalFailureProjectionForStage(input)
	if !validStage || executionfailure.BoundedKind(input.FailureKind) != strings.TrimSpace(input.FailureKind) {
		return executioncontract.FailureOutput{}, executionfailure.PermanentError(
			"execution failure finalizer payload is invalid",
			"execution_failure_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.RunProjectionStore == nil {
		return executioncontract.FailureOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(input.RequestID))
	if err != nil {
		return executioncontract.FailureOutput{}, executionfailure.SanitizedError(
			"execution_failure_finalizer_state_unavailable",
			err,
			errors.Is(err, execution.ErrDurableRunNotFound),
		)
	}
	if run.Status != execution.DurableRunStatusFailed && activityprojection.RunTerminal(run.Status) {
		return executioncontract.FailureOutput{}, executionfailure.PermanentError(
			"execution run reached a conflicting terminal state",
			"execution_failure_terminal_conflict",
			nil,
		)
	}
	steps, err := s.RunProjectionStore.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return executioncontract.FailureOutput{}, err
	}
	for _, step := range steps {
		if step.StepID != input.Stage || step.UpdatedAt.After(input.FailedAt) {
			continue
		}
		failure := execution.CloneAnyMapFromValue(step.SanitizedPayload["failure"])
		sourceCode := execution.StringValue(failure["code"])
		if sourceCode != input.FailureKind {
			// Recovery synthesis deliberately wraps the underlying failure. Only
			// that failed synthesis step owns the cause of this terminal category.
			if input.Stage != "answer.synthesize" || input.FailureKind != "answer_synthesis_failed" ||
				step.Status != "failed" || sourceCode == "" {
				continue
			}
			failure["source_code"] = sourceCode
			failure["code"] = input.FailureKind
		}
		projection.Payload = map[string]any{"failure": failure}
		break
	}
	cause := FixedTemporalFailureError(input.FailureKind)
	projection.FailedAt = input.FailedAt
	projection.FailureKind = input.FailureKind
	failedRun, finalizeErr := s.FailTemporalRun(ctx, run, projection, cause)
	if finalizeErr != nil {
		var applicationError *executionfailure.Error
		if errors.As(finalizeErr, &applicationError) {
			return executioncontract.FailureOutput{}, finalizeErr
		}
		failureKind := "execution_failure_finalizer_failed"
		if errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict) {
			failureKind = "execution_failure_terminal_conflict"
		}
		return executioncontract.FailureOutput{}, executionfailure.SanitizedError(
			failureKind,
			finalizeErr,
			errors.Is(finalizeErr, execution.ErrDurableRunFailureConflict),
		)
	}
	return FinalizedExecutionFailureOutput(failedRun), nil
}

func TemporalFailureProjectionForStage(
	input executioncontract.FailureInput,
) (activityprojection.StepFailureProjection, bool) {
	stage := strings.TrimSpace(input.Stage)
	switch {
	case stage == "solve.initial":
		return activityprojection.StepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "solver",
			TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		}, true
	case strings.HasPrefix(stage, "task.step."):
		return activityprojection.StepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "executor",
			TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		}, true
	case strings.HasPrefix(stage, "solve.replan."):
		return activityprojection.StepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "replanner",
			TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		}, true
	case stage == "answer.synthesize":
		return activityprojection.StepFailureProjection{
			ProjectionRef: activityprojection.WorkflowOperationResultRef(input.RequestID, stage),
			ResultKind:    "activity_failure",
			StepID:        stage,
			StepKind:      "synthesizer",
			TaskQueue:     executioncontract.ActivityTaskQueueAgent,
		}, true
	case stage == "finalization.write":
		return activityprojection.StepFailureProjection{
			ProjectionRef: activityprojection.ProjectionRef(input.RequestID, "finalization/write"),
			ResultKind:    "activity_failure",
			StepID:        "finalization.write",
			StepKind:      "finalization",
			TaskQueue:     executioncontract.ActivityTaskQueueCore,
		}, true
	default:
		return activityprojection.StepFailureProjection{}, false
	}
}

func FinalizedExecutionFailureOutput(run execution.DurableRun) executioncontract.FailureOutput {
	return executioncontract.FailureOutput{
		CompletedAt: run.CompletedAt,
		RequestID:   run.RequestID,
		Status:      string(run.Status),
	}
}
