package executionreconciler

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type workflowStartIntentReader interface {
	GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error)
}

func (r *Reconciler) ReconcileCancellations(ctx context.Context) {
	store := r.store()
	if store == nil {
		return
	}
	now := LifecycleNow()
	token, err := lifecycleLeaseToken("cancel")
	if err != nil {
		r.logWarn("temporal cancellation lease token generation failed", "error", err)
		return
	}
	commands, err := store.LeaseRunCancellationCommands(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: token,
		Now:        now,
		LeaseUntil: now.Add(temporalIntentLease),
		Limit:      temporalReconcileBatch,
	})
	if err != nil {
		if ctx.Err() == nil {
			r.logWarn("temporal cancellation lease failed", "error", err)
		}
		return
	}
	for _, command := range commands {
		if ctx.Err() != nil {
			return
		}
		r.ReconcileCancellationCommand(ctx, store, command)
	}
}

func (r *Reconciler) ReconcileCancellationCommand(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
) {
	run, err := store.GetRun(ctx, command.RequestID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return
	}
	if temporalRunTerminal(run.Status) && run.Status != execution.DurableRunStatusCanceled {
		// The workflow finalizer (or another terminal projector) already won.
		// Never let a cancellation command overwrite a completed/failed run.
		r.confirmCancellation(ctx, store, command)
		return
	}

	control, ok := r.starter.(executionapplication.WorkflowControl)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	startIntent, err := reader.GetWorkflowStartIntent(ctx, command.RequestID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "workflow_start_intent_unavailable")
		return
	}
	if strings.TrimSpace(command.WorkflowID) != strings.TrimSpace(startIntent.WorkflowID) {
		r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
		return
	}
	storedTemporalRunID := strings.TrimSpace(startIntent.TemporalRunID)
	var input execution.WorkflowStartInput
	var expectedIdentity execution.WorkflowIdentity
	if storedTemporalRunID == "" {
		input, err = execution.DecodeAndValidateWorkflowStartInput(startIntent, run)
		if err != nil {
			r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
			return
		}
		expectedIdentity, err = execution.WorkflowIdentityForInput(input)
		if err != nil {
			r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
			return
		}
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, r.operationTimeout)
	info, probeErr := control.DescribeToolExecutionWorkflow(probeCtx, command.WorkflowID, storedTemporalRunID)
	probeCancel()
	if probeErr != nil {
		r.retryCancellation(ctx, store, command, "temporal_cancel_probe_uncertain")
		return
	}
	if !info.Found {
		if storedTemporalRunID != "" {
			r.retryCancellation(ctx, store, command, "temporal_start_identity_unresolved")
			return
		}
		if startIntent.DispatchAttempted {
			// The process may have exited after committing the dispatch fence but
			// before issuing StartWorkflowExecution. Recreate the canonical workflow
			// with a delayed first task, bind the starter-verified root, and then
			// continue through the ordinary exact-run cancel path.
			var recovered bool
			startIntent, info, recovered = r.ensureSupersededWorkflowStartForCancellation(
				ctx,
				store,
				control,
				command,
				run,
				startIntent,
				input,
			)
			if !recovered {
				return
			}
			storedTemporalRunID = strings.TrimSpace(startIntent.TemporalRunID)
		} else {
			r.finalizeCancellationLocally(ctx, store, command, run)
			return
		}
	}
	temporalRunID := strings.TrimSpace(info.RunID)
	if !info.Found || temporalRunID == "" ||
		(storedTemporalRunID != "" && (storedTemporalRunID != temporalRunID ||
			strings.TrimSpace(info.WorkflowID) != strings.TrimSpace(command.WorkflowID))) {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	if storedTemporalRunID == "" {
		if startIntent.State != execution.LifecycleIntentStateSuperseded {
			r.retryCancellation(ctx, store, command, "temporal_start_binding_unavailable")
			return
		}
		verified, found, identityErr := r.verifyUnboundRootWorkflowExecutionCandidate(
			ctx,
			control,
			command.WorkflowID,
			expectedIdentity,
			info,
		)
		if errors.Is(identityErr, execution.ErrWorkflowIdentityConflict) {
			r.finalizeCancellationLocally(ctx, store, command, run)
			return
		}
		if identityErr != nil {
			r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
			return
		}
		if !found {
			r.retryCancellation(ctx, store, command, "temporal_start_binding_unavailable")
			return
		}
		info = verified
		temporalRunID = strings.TrimSpace(verified.RunID)
		bound, bindErr := store.BindSupersededWorkflowStartExecution(
			ctx,
			execution.WorkflowStartExecutionBinding{
				RequestID: command.RequestID, WorkflowID: command.WorkflowID,
				TemporalRunID: temporalRunID, Now: LifecycleNow(),
			},
		)
		if bindErr != nil {
			code := "temporal_start_binding_unavailable"
			if errors.Is(bindErr, execution.ErrWorkflowStartExecutionBindingConflict) {
				code = "temporal_start_binding_conflict"
			}
			r.retryCancellation(ctx, store, command, code)
			return
		}
		startIntent = bound
		storedTemporalRunID = strings.TrimSpace(bound.TemporalRunID)
		if storedTemporalRunID != temporalRunID {
			r.retryCancellation(ctx, store, command, "temporal_start_binding_conflict")
			return
		}
	}
	if r.reconcileClosedWorkflowCancellation(ctx, store, command, run, info) {
		return
	}
	if !r.cancellationStillOwnsActiveRun(ctx, store, command, run, startIntent, temporalRunID) {
		return
	}

	cancelCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	err = r.starter.CancelToolExecutionWorkflow(cancelCtx, execution.WorkflowCancelInput{
		Reason: command.Reason, RequestID: command.RequestID, TemporalRunID: temporalRunID, WorkflowID: command.WorkflowID,
	})
	cancel()
	if err == nil {
		if run.Status == execution.DurableRunStatusCanceled {
			r.confirmCancellation(ctx, store, command)
		} else {
			r.retryCancellation(ctx, store, command, "temporal_cancel_projection_pending")
		}
		return
	}
	probeCtx, probeCancel = context.WithTimeout(ctx, r.operationTimeout)
	latestInfo, latestProbeErr := control.DescribeToolExecutionWorkflow(probeCtx, command.WorkflowID, temporalRunID)
	probeCancel()
	if latestProbeErr != nil {
		r.retryCancellation(ctx, store, command, "temporal_cancel_probe_uncertain")
		return
	}
	if latestInfo.Found && strings.TrimSpace(latestInfo.RunID) == temporalRunID &&
		strings.TrimSpace(latestInfo.WorkflowID) == strings.TrimSpace(command.WorkflowID) {
		if r.reconcileClosedWorkflowCancellation(ctx, store, command, run, latestInfo) {
			return
		}
	}
	r.retryCancellation(ctx, store, command, "temporal_cancel_delivery_uncertain")
}

func (r *Reconciler) cancellationStillOwnsActiveRun(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	startIntent execution.WorkflowStartIntent,
	temporalRunID string,
) bool {
	latestRun, err := store.GetRun(ctx, command.RequestID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return false
	}
	if temporalRunTerminal(latestRun.Status) {
		// Completion/failure/cancellation may have won while visibility was being
		// probed. Retire the stale command without sending a late external cancel.
		r.confirmCancellation(ctx, store, command)
		return false
	}
	if latestRun.ConversationID != run.ConversationID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return false
	}
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return false
	}
	currentStart, err := reader.GetWorkflowStartIntent(ctx, command.RequestID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "workflow_start_intent_unavailable")
		return false
	}
	if currentStart.WorkflowID != startIntent.WorkflowID ||
		strings.TrimSpace(currentStart.TemporalRunID) != strings.TrimSpace(temporalRunID) ||
		(currentStart.State != execution.LifecycleIntentStateConfirmed &&
			currentStart.State != execution.LifecycleIntentStateSuperseded) {
		r.retryCancellation(ctx, store, command, "temporal_cancel_binding_changed")
		return false
	}
	return true
}

func (r *Reconciler) ensureSupersededWorkflowStartForCancellation(
	ctx context.Context,
	store executionapplication.RunStore,
	control executionapplication.WorkflowControl,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	startIntent execution.WorkflowStartIntent,
	input execution.WorkflowStartInput,
) (execution.WorkflowStartIntent, execution.WorkflowExecutionInfo, bool) {
	if startIntent.State != execution.LifecycleIntentStateSuperseded ||
		!startIntent.DispatchAttempted || strings.TrimSpace(startIntent.TemporalRunID) != "" {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_state_invalid")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	recoveryStarter, ok := r.starter.(executionapplication.WorkflowCancellationRecoveryStarter)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_start_unavailable")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	latestRun, err := store.GetRun(ctx, command.RequestID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	if temporalRunTerminal(latestRun.Status) {
		r.confirmCancellation(ctx, store, command)
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	if latestRun.ConversationID != run.ConversationID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_invalid")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	startCtx, cancel := context.WithTimeout(
		traceContextForWorkflowStart(ctx, input),
		r.operationTimeout,
	)
	temporalRunID, err := recoveryStarter.EnsureToolExecutionWorkflowForCancellation(startCtx, input)
	cancel()
	if err != nil {
		code := "temporal_cancel_recovery_start_uncertain"
		if errors.Is(err, execution.ErrWorkflowIdentityConflict) ||
			errors.Is(err, execution.ErrWorkflowOwnershipUnsafe) {
			code = "temporal_cancel_recovery_identity_conflict"
		}
		r.retryCancellation(ctx, store, command, code)
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	temporalRunID = strings.TrimSpace(temporalRunID)
	if temporalRunID == "" {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_unavailable")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	bound, bindErr := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID:     command.RequestID,
		WorkflowID:    startIntent.WorkflowID,
		TemporalRunID: temporalRunID,
		Now:           LifecycleNow(),
	})
	if bindErr != nil {
		code := "temporal_cancel_recovery_binding_unavailable"
		if errors.Is(bindErr, execution.ErrWorkflowStartExecutionBindingConflict) {
			code = "temporal_cancel_recovery_binding_conflict"
		}
		r.retryCancellation(ctx, store, command, code)
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	if strings.TrimSpace(bound.TemporalRunID) != temporalRunID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_binding_conflict")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	// The starter already verified this root. Bind first, then read its current
	// status for the ordinary exact-run cancellation path.
	probeCtx, probeCancel := context.WithTimeout(ctx, r.operationTimeout)
	info, probeErr := control.DescribeToolExecutionWorkflow(probeCtx, bound.WorkflowID, temporalRunID)
	probeCancel()
	if probeErr != nil {
		r.retryCancellation(ctx, store, command, "temporal_cancel_probe_uncertain")
		return execution.WorkflowStartIntent{}, execution.WorkflowExecutionInfo{}, false
	}
	return bound, info, true
}

func (r *Reconciler) reconcileClosedWorkflowCancellation(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	info execution.WorkflowExecutionInfo,
) bool {
	switch info.Status {
	case execution.WorkflowExecutionStatusCanceled:
		r.finalizeCancellationLocally(ctx, store, command, run)
	case execution.WorkflowExecutionStatusTimedOut:
		if info.CloseTime.IsZero() {
			r.retryCancellation(ctx, store, command, "temporal_cancel_close_time_unavailable")
			return true
		}
		if !r.confirmCancellation(ctx, store, command) {
			return true
		}
		if err := r.finalizeTimedOutWorkflow(ctx, store, run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow timeout finalization failed", "request_id", run.RequestID, "error", err)
		}
	case execution.WorkflowExecutionStatusTerminated:
		if info.CloseTime.IsZero() {
			r.retryCancellation(ctx, store, command, "temporal_cancel_close_time_unavailable")
			return true
		}
		if !r.confirmCancellation(ctx, store, command) {
			return true
		}
		if err := r.finalizeTerminatedWorkflow(ctx, store, run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow termination finalization failed", "request_id", run.RequestID, "error", err)
		}
	case execution.WorkflowExecutionStatusContinuedAsNew:
		if info.CloseTime.IsZero() {
			r.retryCancellation(ctx, store, command, "temporal_cancel_close_time_unavailable")
			return true
		}
		if !r.confirmCancellation(ctx, store, command) {
			return true
		}
		if err := r.finalizeClosedWorkflowFailure(ctx, store, run, info.CloseTime, WorkflowExecutionClosedInvariantFailure); err != nil && ctx.Err() == nil {
			r.logWarn("unsupported Temporal workflow closure finalization failed", "request_id", run.RequestID, "error", err)
		}
	case execution.WorkflowExecutionStatusCompleted,
		execution.WorkflowExecutionStatusFailed:
		// Temporal already chose a non-cancellation close status. Retire the
		// cancellation command so the corresponding terminal projector can win.
		r.confirmCancellation(ctx, store, command)
	default:
		return false
	}
	return true
}

func (r *Reconciler) finalizeCancellationLocally(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
) {
	// Re-read immediately before local closeout. A completed/failed/expired
	// durable projection that committed first wins without a stale callback.
	latestRun, latestErr := store.GetRun(ctx, command.RequestID)
	if latestErr != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return
	}
	if temporalRunTerminal(latestRun.Status) && latestRun.Status != execution.DurableRunStatusCanceled {
		r.confirmCancellation(ctx, store, command)
		return
	}
	finalizeCtx, finalizeCancel := context.WithTimeout(ctx, 30*time.Second)
	_, finalizeErr := r.finalizer.FinalizeExecutionCancellation(finalizeCtx, execution.ExecutionCancellationFinalizationInput{
		CanceledAt: command.CreatedAt.UTC().Truncate(time.Microsecond),
		Reason:     command.Reason,
		RequestID:  command.RequestID,
	})
	finalizeCancel()
	if finalizeErr != nil {
		// The finalizer deliberately rejects a completed/failed run. Treat that
		// race as a projection win rather than retrying a cancellation forever.
		if projectedRun, readErr := store.GetRun(ctx, command.RequestID); readErr == nil && temporalRunTerminal(projectedRun.Status) {
			r.confirmCancellation(ctx, store, command)
			return
		}
		r.retryCancellation(ctx, store, command, "cancellation_finalization_failed")
		return
	}
	r.confirmCancellation(ctx, store, command)
}

func (r *Reconciler) confirmCancellation(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
) bool {
	err := store.ConfirmRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RequestID: command.RequestID, LeaseToken: command.LeaseToken, Now: LifecycleNow(),
	})
	if err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation confirmation failed", "request_id", command.RequestID, "error", err)
	}
	return err == nil
}

func (r *Reconciler) retryCancellation(
	ctx context.Context,
	store executionapplication.RunStore,
	command execution.RunCancellationCommand,
	code string,
) {
	now := LifecycleNow()
	if err := store.RetryRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RequestID: command.RequestID, LeaseToken: command.LeaseToken, ErrorCode: boundedLifecycleErrorCode(code),
		Now: now, NextAttemptAt: now.Add(lifecycleRetryDelay(command.AttemptCount)),
	}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation retry persistence failed", "request_id", command.RequestID, "error", err)
	}
}
