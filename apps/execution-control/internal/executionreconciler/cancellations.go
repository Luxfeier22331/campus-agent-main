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
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
) {
	run, err := store.GetRun(ctx, command.RunID)
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

	control, ok := r.starter.(temporalruntime.WorkflowControl)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	startIntent, err := reader.GetWorkflowStartIntent(ctx, command.RunID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "workflow_start_intent_unavailable")
		return
	}
	if strings.TrimSpace(command.WorkflowID) != strings.TrimSpace(startIntent.WorkflowID) {
		r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
		return
	}
	input, err := r.DecodeAndValidateWorkflowStartInput(startIntent, run)
	if err != nil {
		r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
		return
	}
	expectedIdentity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		r.retryCancellation(ctx, store, command, "workflow_start_identity_invalid")
		return
	}
	storedTemporalRunID := strings.TrimSpace(startIntent.TemporalRunID)
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
			// with a delayed first task, verify the exact root/latest execution, bind
			// it durably, and then continue through the ordinary exact-run cancel path.
			var recovered bool
			startIntent, info, recovered = r.ensureSupersededWorkflowStartForCancellation(
				ctx,
				store,
				control,
				command,
				run,
				startIntent,
				input,
				expectedIdentity,
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
	if storedTemporalRunID != "" &&
		(strings.TrimSpace(info.RunID) != storedTemporalRunID ||
			strings.TrimSpace(info.FirstRunID) != storedTemporalRunID) {
		r.retryCancellation(ctx, store, command, "temporal_cancel_chain_identity_unavailable")
		return
	}
	identityErr := temporalruntime.ValidateToolExecutionWorkflowIdentity(info, expectedIdentity)
	if errors.Is(identityErr, temporalruntime.ErrWorkflowIdentityConflict) {
		// The durable run does not own this execution. Never deliver a cancel
		// to it; close only the local product run selected by the command.
		r.finalizeCancellationLocally(ctx, store, command, run)
		return
	}
	if identityErr != nil {
		if errors.Is(identityErr, temporalruntime.ErrWorkflowOwnershipUnsafe) &&
			storedTemporalRunID != "" && temporalWorkflowMemoIdentityMatches(info, expectedIdentity) &&
			temporalWorkflowTerminal(info.Status) && !info.CloseTime.IsZero() &&
			r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				run,
				startIntent,
				expectedIdentity,
				info,
				&command,
			) {
			return
		}
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	temporalRunID := strings.TrimSpace(info.RunID)
	if temporalRunID == "" || (storedTemporalRunID != "" && storedTemporalRunID != temporalRunID) {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return
	}
	if storedTemporalRunID == "" {
		if startIntent.State != execution.LifecycleIntentStateSuperseded {
			r.retryCancellation(ctx, store, command, "temporal_start_binding_unavailable")
			return
		}
		verified, found := r.verifyUnboundRootWorkflowExecutionCandidate(
			ctx,
			control,
			command.WorkflowID,
			expectedIdentity,
			info,
		)
		if !found {
			r.retryCancellation(ctx, store, command, "temporal_start_binding_unavailable")
			return
		}
		info = verified
		temporalRunID = strings.TrimSpace(verified.RunID)
		bound, bindErr := store.BindSupersededWorkflowStartExecution(
			ctx,
			execution.WorkflowStartExecutionBinding{
				RunID: command.RunID, WorkflowID: command.WorkflowID,
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
	} else {
		if strings.TrimSpace(info.FirstRunID) != temporalRunID {
			r.retryCancellation(ctx, store, command, "temporal_cancel_chain_identity_unavailable")
			return
		}
		latest, found := r.describeLatestMatchingBoundWorkflowExecution(
			ctx,
			control,
			command.WorkflowID,
			temporalRunID,
			expectedIdentity,
			info.FirstRunID,
		)
		if !found {
			if r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				run,
				startIntent,
				expectedIdentity,
				info,
				&command,
			) {
				return
			}
			r.retryCancellation(ctx, store, command, "temporal_cancel_chain_identity_unavailable")
			return
		}
		info = latest
	}
	if info.Status == enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW {
		r.retryCancellation(ctx, store, command, "temporal_cancel_chain_advancing")
		return
	}
	if r.reconcileClosedWorkflowCancellation(ctx, store, command, run, info) {
		return
	}
	if !r.cancellationStillOwnsActiveRun(ctx, store, command, run, startIntent, temporalRunID) {
		return
	}

	cancelCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	err = r.starter.CancelToolExecutionWorkflow(cancelCtx, temporalruntime.ToolExecutionWorkflowCancelInput{
		Reason: command.Reason, RunID: command.RunID, TemporalRunID: temporalRunID, WorkflowID: command.WorkflowID,
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
		temporalruntime.ValidateToolExecutionWorkflowIdentity(latestInfo, expectedIdentity) == nil &&
		temporalWorkflowTerminal(latestInfo.Status) {
		latest, found := r.describeLatestMatchingBoundWorkflowExecution(
			ctx,
			control,
			command.WorkflowID,
			temporalRunID,
			expectedIdentity,
			latestInfo.FirstRunID,
		)
		if !found {
			if r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				run,
				startIntent,
				expectedIdentity,
				latestInfo,
				&command,
			) {
				return
			}
			r.retryCancellation(ctx, store, command, "temporal_cancel_chain_identity_unavailable")
			return
		}
		if latest.Status == enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW {
			r.retryCancellation(ctx, store, command, "temporal_cancel_chain_advancing")
			return
		}
		if r.reconcileClosedWorkflowCancellation(ctx, store, command, run, latest) {
			return
		}
	}
	r.retryCancellation(ctx, store, command, "temporal_cancel_delivery_uncertain")
}

func (r *Reconciler) cancellationStillOwnsActiveRun(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	startIntent execution.WorkflowStartIntent,
	temporalRunID string,
) bool {
	latestRun, err := store.GetRun(ctx, command.RunID)
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
	if latestRun.TraceID != run.TraceID || latestRun.ConversationID != run.ConversationID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return false
	}
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_identity_unavailable")
		return false
	}
	currentStart, err := reader.GetWorkflowStartIntent(ctx, command.RunID)
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
	store execution.RunProjectionStore,
	control temporalruntime.WorkflowControl,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	startIntent execution.WorkflowStartIntent,
	input temporalruntime.ToolExecutionWorkflowInput,
	expectedIdentity temporalruntime.ToolExecutionWorkflowIdentity,
) (execution.WorkflowStartIntent, temporalruntime.WorkflowExecutionInfo, bool) {
	if startIntent.State != execution.LifecycleIntentStateSuperseded ||
		!startIntent.DispatchAttempted || strings.TrimSpace(startIntent.TemporalRunID) != "" {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_state_invalid")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	recoveryStarter, ok := r.starter.(temporalruntime.WorkflowCancellationRecoveryStarter)
	if !ok {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_start_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	latestRun, err := store.GetRun(ctx, command.RunID)
	if err != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	if temporalRunTerminal(latestRun.Status) {
		r.confirmCancellation(ctx, store, command)
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	if latestRun.TraceID != run.TraceID || latestRun.ConversationID != run.ConversationID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_invalid")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	startCtx, cancel := context.WithTimeout(
		traceContextForWorkflowStart(ctx, input),
		r.operationTimeout,
	)
	temporalRunID, err := recoveryStarter.EnsureToolExecutionWorkflowForCancellation(startCtx, input)
	cancel()
	if err != nil {
		code := "temporal_cancel_recovery_start_uncertain"
		if errors.Is(err, temporalruntime.ErrWorkflowIdentityConflict) ||
			errors.Is(err, temporalruntime.ErrWorkflowOwnershipUnsafe) {
			code = "temporal_cancel_recovery_identity_conflict"
		}
		r.retryCancellation(ctx, store, command, code)
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	temporalRunID = strings.TrimSpace(temporalRunID)
	if temporalRunID == "" {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, r.operationTimeout)
	exact, probeErr := control.DescribeToolExecutionWorkflow(probeCtx, startIntent.WorkflowID, temporalRunID)
	probeCancel()
	if probeErr != nil || strings.TrimSpace(exact.RunID) != temporalRunID ||
		strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	identityErr := temporalruntime.ValidateToolExecutionWorkflowIdentity(exact, expectedIdentity)
	if identityErr != nil {
		if errors.Is(identityErr, temporalruntime.ErrWorkflowOwnershipUnsafe) &&
			temporalWorkflowMemoIdentityMatches(exact, expectedIdentity) &&
			temporalWorkflowTerminal(exact.Status) && !exact.CloseTime.IsZero() &&
			r.failCloseUnauthorizedWorkflowSuccessor(
				ctx,
				store,
				control,
				run,
				startIntent,
				expectedIdentity,
				exact,
				&command,
			) {
			return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
		}
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_identity_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	latest, found := r.describeLatestMatchingBoundWorkflowExecution(
		ctx,
		control,
		startIntent.WorkflowID,
		temporalRunID,
		expectedIdentity,
		temporalRunID,
	)
	if !found {
		if r.failCloseUnauthorizedWorkflowSuccessor(
			ctx,
			store,
			control,
			run,
			startIntent,
			expectedIdentity,
			exact,
			&command,
		) {
			return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
		}
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_chain_unavailable")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	bound, bindErr := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RunID:         command.RunID,
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
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	if strings.TrimSpace(bound.TemporalRunID) != temporalRunID {
		r.retryCancellation(ctx, store, command, "temporal_cancel_recovery_binding_conflict")
		return execution.WorkflowStartIntent{}, temporalruntime.WorkflowExecutionInfo{}, false
	}
	return bound, latest, true
}

func (r *Reconciler) reconcileClosedWorkflowCancellation(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
	info temporalruntime.WorkflowExecutionInfo,
) bool {
	switch info.Status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		r.finalizeCancellationLocally(ctx, store, command, run)
	case enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		if info.CloseTime.IsZero() {
			r.retryCancellation(ctx, store, command, "temporal_cancel_close_time_unavailable")
			return true
		}
		if !r.confirmCancellation(ctx, store, command) {
			return true
		}
		if err := r.finalizeTimedOutWorkflow(ctx, store, run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow timeout finalization failed", "run_id", run.RunID, "error", err)
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED:
		if info.CloseTime.IsZero() {
			r.retryCancellation(ctx, store, command, "temporal_cancel_close_time_unavailable")
			return true
		}
		if !r.confirmCancellation(ctx, store, command) {
			return true
		}
		if err := r.finalizeTerminatedWorkflow(ctx, store, run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow termination finalization failed", "run_id", run.RunID, "error", err)
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED:
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
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
	run execution.DurableRun,
) {
	// Re-read immediately before local closeout. A completed/failed/expired
	// durable projection that committed first wins without a stale callback.
	latestRun, latestErr := store.GetRun(ctx, command.RunID)
	if latestErr != nil {
		r.retryCancellation(ctx, store, command, "run_unavailable")
		return
	}
	if temporalRunTerminal(latestRun.Status) && latestRun.Status != execution.DurableRunStatusCanceled {
		r.confirmCancellation(ctx, store, command)
		return
	}
	finalizeCtx, finalizeCancel := context.WithTimeout(ctx, 30*time.Second)
	_, finalizeErr := r.finalizer.FinalizeExecutionCancellation(finalizeCtx, temporalruntime.FinalizeExecutionCancellationActivityInput{
		CanceledAt: command.CreatedAt.UTC().Truncate(time.Microsecond),
		Reason:     command.Reason,
		RunID:      command.RunID,
		TraceID:    latestRun.TraceID,
	})
	finalizeCancel()
	if finalizeErr != nil {
		// The finalizer deliberately rejects a completed/failed run. Treat that
		// race as a projection win rather than retrying a cancellation forever.
		if projectedRun, readErr := store.GetRun(ctx, command.RunID); readErr == nil && temporalRunTerminal(projectedRun.Status) {
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
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
) bool {
	err := store.ConfirmRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RunID: command.RunID, LeaseToken: command.LeaseToken, Now: LifecycleNow(),
	})
	if err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation confirmation failed", "run_id", command.RunID, "error", err)
	}
	return err == nil
}

func (r *Reconciler) retryCancellation(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
	code string,
) {
	now := LifecycleNow()
	if err := store.RetryRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RunID: command.RunID, LeaseToken: command.LeaseToken, ErrorCode: boundedLifecycleErrorCode(code),
		Now: now, NextAttemptAt: now.Add(lifecycleRetryDelay(command.AttemptCount)),
	}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation retry persistence failed", "run_id", command.RunID, "error", err)
	}
}
