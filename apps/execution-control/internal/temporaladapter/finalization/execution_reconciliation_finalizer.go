package finalization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Adapter) FailWorkflowStart(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) error {
	now := time.Now().UTC().Truncate(time.Microsecond)
	if err := s.GuardAgainstFinalizationSuccess(ctx, run, failureKind); err != nil {
		return err
	}
	projection := activityprojection.TemporalStepFailureProjection{
		FailedAt:        now,
		FailureKind:     failureKind,
		ProjectionRef:   activityprojection.TemporalProjectionRef(run.RequestID, "workflow/start"),
		ResultKind:      "activity_failure",
		StepID:          "workflow.start",
		StepKind:        "workflow",
		TaskQueue:       temporalruntime.WorkflowTaskQueue,
		FailCloseReason: failureKind,
	}
	if err := s.ProjectTemporalFailureStep(ctx, run, projection, cause); err != nil {
		return err
	}
	_, err := s.FailTemporalRun(ctx, run, projection, cause)
	return err
}

func (s *Adapter) FinalizeWorkflowTimeout(
	ctx context.Context,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	latest, err := s.RunProjectionStore.GetRun(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if activityprojection.TemporalRunTerminal(latest.Status) {
		return nil
	}
	if latest.RequestID != run.RequestID || latest.ConversationID != run.ConversationID {
		return errors.New("workflow timeout durable identity changed")
	}
	expiredAt := closedAt.UTC().Truncate(time.Microsecond)
	failureKind := "workflow_execution_timeout"
	if err := s.GuardAgainstFinalizationSuccess(ctx, latest, failureKind); err != nil {
		return err
	}
	projection := activityprojection.TemporalStepFailureProjection{
		FailedAt:        expiredAt,
		FailureKind:     failureKind,
		FailCloseReason: failureKind,
		ProjectionRef:   activityprojection.TemporalProjectionRef(run.RequestID, "workflow/execution"),
		ResultKind:      "workflow_timeout",
		StepID:          "workflow.execution",
		StepKind:        "workflow",
		TaskQueue:       run.TaskQueue,
		TimeoutOutcome:  execution.TimeoutOutcomeWorkflowTimeout,
	}
	if err := s.ProjectTemporalFailureStep(ctx, latest, projection, context.DeadlineExceeded); err != nil {
		return err
	}
	writeProductFinalization := s.ProductFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = s.WriteChatProductFinalization
	}
	if err := writeProductFinalization(ctx, latest, expiredAt, ProductTerminalErrorResponse(
		latest,
		"error",
		"execution_timeout",
		"The execution exceeded its workflow timeout.",
		true,
	)); err != nil {
		return err
	}
	_, err = s.RunProjectionStore.ExpireRunProjection(ctx, execution.DurableRunExpireRequest{
		RequestID: latest.RequestID,
		Now:       expiredAt,
	})
	return err
}

func (s *Adapter) FinalizeWorkflowClosure(
	ctx context.Context,
	run execution.DurableRun,
	closedAt time.Time,
	failureKind string,
) error {
	latest, err := s.RunProjectionStore.GetRun(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if latest.RequestID != run.RequestID || latest.ConversationID != run.ConversationID {
		return errors.New("workflow termination durable identity changed")
	}
	failedAt := closedAt.UTC().Truncate(time.Microsecond)
	if err := s.GuardAgainstFinalizationSuccess(ctx, latest, failureKind); err != nil {
		return err
	}
	projection := activityprojection.TemporalStepFailureProjection{
		FailedAt:        failedAt,
		FailureKind:     failureKind,
		FailCloseReason: failureKind,
		ProjectionRef:   activityprojection.TemporalProjectionRef(run.RequestID, "workflow/execution"),
		ResultKind:      "activity_failure",
		StepID:          "workflow.execution",
		StepKind:        "workflow",
		TaskQueue:       run.TaskQueue,
	}
	cause := FixedTemporalFailureError(failureKind)
	if activityprojection.TemporalRunTerminal(latest.Status) {
		if latest.Status != execution.DurableRunStatusFailed {
			return fmt.Errorf("workflow termination conflicts with durable terminal status %s", latest.Status)
		}
		_, err := s.FailTemporalRun(ctx, latest, projection, cause)
		return err
	}
	if err := s.ProjectTemporalFailureStep(ctx, latest, projection, cause); err != nil {
		return err
	}
	_, err = s.FailTemporalRun(ctx, latest, projection, cause)
	return err
}
