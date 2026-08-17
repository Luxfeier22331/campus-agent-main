package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) ValidateWorkflowAdmission(
	snapshot temporalruntime.AgentAdmissionSnapshot,
	visibleToolNames []string,
) error {
	return validateAdmissionSnapshotForVisibleTools(snapshot, visibleToolNames)
}

func (s *Server) FailWorkflowStart(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) error {
	now := time.Now().UTC().Truncate(time.Microsecond)
	projection := temporalStepFailureProjection{
		FailedAt:        now,
		FailureHash:     reconciliationFailureHash(failureKind),
		FailureKind:     failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "workflow/start"),
		ResultKind:      "activity_failure",
		StepID:          "workflow.start",
		StepKind:        "workflow",
		TaskQueue:       temporalruntime.WorkflowTaskQueue,
		FailCloseReason: failureKind,
	}
	if err := s.projectTemporalFailureStep(ctx, run, projection, cause); err != nil {
		return err
	}
	_, err := s.failTemporalRun(ctx, run, projection, cause)
	return err
}

func (s *Server) FinalizeWorkflowTimeout(
	ctx context.Context,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if temporalRunTerminal(latest.Status) {
		return nil
	}
	if latest.TraceID != run.TraceID || latest.ConversationID != run.ConversationID {
		return errors.New("workflow timeout durable identity changed")
	}
	expiredAt := closedAt.UTC().Truncate(time.Microsecond)
	failureKind := "workflow_execution_timeout"
	projection := temporalStepFailureProjection{
		FailedAt:        expiredAt,
		FailureHash:     reconciliationFailureHash(failureKind),
		FailureKind:     failureKind,
		FailCloseReason: failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "workflow/execution"),
		ResultKind:      "workflow_timeout",
		StepID:          "workflow.execution",
		StepKind:        "workflow",
		TaskQueue:       run.TaskQueue,
		TimeoutOutcome:  execution.TimeoutOutcomeWorkflowTimeout,
	}
	if err := s.projectTemporalFailureStep(ctx, latest, projection, context.DeadlineExceeded); err != nil {
		return err
	}
	writeProductFinalization := s.productFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = s.writeChatProductFinalization
	}
	if err := writeProductFinalization(ctx, latest, expiredAt, productTerminalErrorResponse(
		latest,
		"error",
		"execution_timeout",
		"The execution exceeded its workflow timeout.",
		true,
	)); err != nil {
		return err
	}
	_, err = s.runProjectionStore.ExpireRunProjection(ctx, execution.DurableRunExpireRequest{
		RunID: latest.RunID,
		Now:   expiredAt,
	})
	return err
}

func (s *Server) FinalizeWorkflowClosure(
	ctx context.Context,
	run execution.DurableRun,
	closedAt time.Time,
	failureKind string,
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if latest.TraceID != run.TraceID || latest.ConversationID != run.ConversationID {
		return errors.New("workflow termination durable identity changed")
	}
	failedAt := closedAt.UTC().Truncate(time.Microsecond)
	projection := temporalStepFailureProjection{
		FailedAt:        failedAt,
		FailureHash:     reconciliationFailureHash(failureKind),
		FailureKind:     failureKind,
		FailCloseReason: failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "workflow/execution"),
		ResultKind:      "activity_failure",
		StepID:          "workflow.execution",
		StepKind:        "workflow",
		TaskQueue:       run.TaskQueue,
	}
	cause := fixedTemporalFailureError(failureKind)
	if temporalRunTerminal(latest.Status) {
		if latest.Status != execution.DurableRunStatusFailed {
			return fmt.Errorf("workflow termination conflicts with durable terminal status %s", latest.Status)
		}
		_, err := s.failTemporalRun(ctx, latest, projection, cause)
		return err
	}
	if err := s.projectTemporalFailureStep(ctx, latest, projection, cause); err != nil {
		return err
	}
	_, err = s.failTemporalRun(ctx, latest, projection, cause)
	return err
}

func reconciliationFailureHash(code string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(digest[:])
}
