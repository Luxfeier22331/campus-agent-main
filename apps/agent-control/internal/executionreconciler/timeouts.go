package executionreconciler

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type activeWorkflowRunReader interface {
	ListActiveWorkflowRuns(context.Context, string, int) ([]execution.ActiveWorkflowRun, error)
}

func (r *Reconciler) ReconcileWorkflowTimeouts(ctx context.Context) {
	store := r.store()
	reader, readerOK := store.(activeWorkflowRunReader)
	control, controlOK := r.starter.(executionapplication.WorkflowControl)
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
	store executionapplication.RunStore,
	control executionapplication.WorkflowControl,
	binding execution.ActiveWorkflowRun,
) {
	rootTemporalRunID := strings.TrimSpace(binding.StartIntent.TemporalRunID)
	if rootTemporalRunID == "" {
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
	if !info.Found || strings.TrimSpace(info.RunID) != rootTemporalRunID ||
		strings.TrimSpace(info.WorkflowID) != strings.TrimSpace(binding.StartIntent.WorkflowID) {
		return
	}
	switch info.Status {
	case execution.WorkflowExecutionStatusTimedOut:
		if info.CloseTime.IsZero() {
			return
		}
		if err := r.finalizeTimedOutWorkflow(ctx, store, binding.Run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow timeout finalization failed", "request_id", binding.Run.RequestID, "error", err)
		}
	case execution.WorkflowExecutionStatusTerminated:
		if info.CloseTime.IsZero() {
			return
		}
		if err := r.finalizeTerminatedWorkflow(ctx, store, binding.Run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow termination finalization failed", "request_id", binding.Run.RequestID, "error", err)
		}
	case execution.WorkflowExecutionStatusCompleted,
		execution.WorkflowExecutionStatusFailed,
		execution.WorkflowExecutionStatusCanceled,
		execution.WorkflowExecutionStatusContinuedAsNew:
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
	_ executionapplication.RunStore,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	return r.finalizer.FinalizeWorkflowTimeout(ctx, run, closedAt)
}

func (r *Reconciler) finalizeTerminatedWorkflow(
	ctx context.Context,
	store executionapplication.RunStore,
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
	_ executionapplication.RunStore,
	run execution.DurableRun,
	closedAt time.Time,
	failureKind string,
) error {
	return r.finalizer.FinalizeWorkflowClosure(ctx, run, closedAt, failureKind)
}

func workflowClosedWithoutProjectionFailure(status execution.WorkflowExecutionStatus) (string, bool) {
	switch status {
	case execution.WorkflowExecutionStatusCompleted:
		return WorkflowCompletedUnprojectedFailure, true
	case execution.WorkflowExecutionStatusFailed:
		return WorkflowFailedUnprojectedFailure, true
	case execution.WorkflowExecutionStatusCanceled:
		return WorkflowCanceledUnprojectedFailure, true
	case execution.WorkflowExecutionStatusContinuedAsNew:
		return WorkflowExecutionClosedInvariantFailure, true
	default:
		return "", false
	}
}
