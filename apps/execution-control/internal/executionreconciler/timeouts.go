package executionreconciler

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"strings"
	"time"
)

type activeWorkflowRunReader interface {
	ListActiveWorkflowRuns(context.Context, string, int) ([]execution.ActiveWorkflowRun, error)
}

func (r *Reconciler) ReconcileWorkflowTimeouts(ctx context.Context) {
	store := r.store()
	reader, readerOK := store.(activeWorkflowRunReader)
	control, controlOK := r.starter.(temporalruntime.WorkflowControl)
	if store == nil || !readerOK || !controlOK {
		return
	}
	bindings, err := reader.ListActiveWorkflowRuns(ctx, r.activeWorkflowCursor, temporalReconcileBatch)
	if err == nil && len(bindings) == 0 && r.activeWorkflowCursor != "" {
		// Reaching the end (or losing rows before the cursor to concurrent
		// finalization) wraps the bounded scan without making one failed item
		// permanently monopolize the first page.
		r.activeWorkflowCursor = ""
		bindings, err = reader.ListActiveWorkflowRuns(ctx, "", temporalReconcileBatch)
	}
	if err != nil {
		if ctx.Err() == nil {
			r.logWarn("active Temporal workflow scan failed", "error", err)
		}
		return
	}
	for _, binding := range bindings {
		if ctx.Err() != nil {
			return
		}
		r.reconcileWorkflowTimeout(ctx, store, control, binding)
		if ctx.Err() != nil {
			return
		}
		r.activeWorkflowCursor = binding.Run.RequestID
	}
	if len(bindings) < temporalReconcileBatch {
		r.activeWorkflowCursor = ""
	}
}

func (r *Reconciler) reconcileWorkflowTimeout(
	ctx context.Context,
	store execution.RunProjectionStore,
	control temporalruntime.WorkflowControl,
	binding execution.ActiveWorkflowRun,
) {
	input, decodeErr := r.DecodeAndValidateWorkflowStartInput(binding.StartIntent, binding.Run)
	if decodeErr != nil {
		r.logWarn("confirmed Temporal workflow identity is invalid", "request_id", binding.Run.RequestID, "error", decodeErr)
		return
	}
	expected, identityErr := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if identityErr != nil {
		return
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	info, probeErr := control.DescribeToolExecutionWorkflow(
		probeCtx,
		binding.StartIntent.WorkflowID,
		binding.StartIntent.TemporalRunID,
	)
	cancel()
	if probeErr != nil {
		return
	}
	rootTemporalRunID := strings.TrimSpace(binding.StartIntent.TemporalRunID)
	if strings.TrimSpace(info.RunID) != rootTemporalRunID ||
		strings.TrimSpace(info.FirstRunID) != rootTemporalRunID {
		return
	}
	if identityErr = temporalruntime.ValidateToolExecutionWorkflowIdentity(info, expected); identityErr != nil {
		if errors.Is(identityErr, temporalruntime.ErrWorkflowOwnershipUnsafe) &&
			temporalWorkflowMemoIdentityMatches(info, expected) &&
			temporalWorkflowTerminal(info.Status) && !info.CloseTime.IsZero() {
			r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				binding.Run,
				binding.StartIntent,
				expected,
				info,
				nil,
			)
		}
		if errors.Is(identityErr, temporalruntime.ErrWorkflowIdentityConflict) {
			r.logWarn("confirmed Temporal workflow identity conflict", "request_id", binding.Run.RequestID)
		}
		return
	}
	if temporalWorkflowTerminal(info.Status) {
		latest, found := r.describeLatestMatchingBoundWorkflowExecution(
			ctx,
			control,
			binding.StartIntent.WorkflowID,
			binding.StartIntent.TemporalRunID,
			expected,
			info.FirstRunID,
		)
		if !found {
			r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				binding.Run,
				binding.StartIntent,
				expected,
				info,
				nil,
			)
			return
		}
		info = latest
	}
	switch info.Status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		if info.CloseTime.IsZero() {
			return
		}
		if err := r.finalizeTimedOutWorkflow(ctx, store, binding.Run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow timeout finalization failed", "request_id", binding.Run.RequestID, "error", err)
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED:
		if info.CloseTime.IsZero() {
			return
		}
		if err := r.finalizeTerminatedWorkflow(ctx, store, binding.Run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow termination finalization failed", "request_id", binding.Run.RequestID, "error", err)
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		if info.CloseTime.IsZero() {
			return
		}
		failureKind, ok := workflowClosedWithoutProjectionFailure(info.Status)
		if !ok {
			return
		}
		if err := r.finalizeClosedWorkflowFailure(ctx, store, binding.Run, info.CloseTime, failureKind); err != nil && ctx.Err() == nil {
			r.logWarn(
				"closed Temporal workflow terminal projection repair failed",
				"request_id", binding.Run.RequestID,
				"status", info.Status.String(),
				"error", err,
			)
		}
	}
}

func (r *Reconciler) finalizeTimedOutWorkflow(
	ctx context.Context,
	_ execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	return r.finalizer.FinalizeWorkflowTimeout(ctx, run, closedAt)
}

func (r *Reconciler) finalizeTerminatedWorkflow(
	ctx context.Context,
	store execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	return r.finalizeClosedWorkflowFailure(
		ctx,
		store,
		run,
		closedAt,
		WorkflowExecutionTerminatedFailure,
	)
}

func (r *Reconciler) finalizeClosedWorkflowFailure(
	ctx context.Context,
	_ execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
	failureKind string,
) error {
	return r.finalizer.FinalizeWorkflowClosure(ctx, run, closedAt, failureKind)
}

func workflowClosedWithoutProjectionFailure(status enumspb.WorkflowExecutionStatus) (string, bool) {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED:
		return WorkflowCompletedUnprojectedFailure, true
	case enumspb.WORKFLOW_EXECUTION_STATUS_FAILED:
		return WorkflowFailedUnprojectedFailure, true
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		return WorkflowCanceledUnprojectedFailure, true
	default:
		return "", false
	}
}
