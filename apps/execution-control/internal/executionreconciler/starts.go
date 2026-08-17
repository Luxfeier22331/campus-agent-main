package executionreconciler

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"strings"
)

func (r *Reconciler) ReconcileStarts(ctx context.Context) {
	store := r.store()
	if store == nil {
		return
	}
	now := LifecycleNow()
	token, err := lifecycleLeaseToken("start")
	if err != nil {
		r.logWarn("temporal start lease token generation failed", "error", err)
		return
	}
	intents, err := store.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: token,
		Now:        now,
		LeaseUntil: now.Add(temporalIntentLease),
		Limit:      temporalReconcileBatch,
	})
	if err != nil {
		if ctx.Err() == nil {
			r.logWarn("temporal start intent lease failed", "error", err)
		}
		return
	}
	for _, intent := range intents {
		if ctx.Err() != nil {
			return
		}
		r.ReconcileStartIntent(ctx, store, intent)
	}
}

func (r *Reconciler) ReconcileStartIntent(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
) {
	run, err := store.GetRun(ctx, intent.RunID)
	if err != nil {
		r.retryStart(ctx, store, intent, "run_unavailable")
		return
	}
	if run.Status == execution.DurableRunStatusCanceled || temporalRunTerminal(run.Status) {
		// Recover the only crash window that proves no StartWorkflowExecution RPC
		// was issued: local input validation failed and the run terminalized before
		// the leased start intent could be retired. Every other terminal start stays
		// fail-closed because an earlier attempt may have reached Temporal.
		failureKind := "run_terminal_before_workflow_start"
		switch run.FailCloseReason {
		case WorkflowStartNotDispatchedFailure:
			failureKind = WorkflowStartNotDispatchedFailure
		case WorkflowStartPostDispatchFailure:
			failureKind = WorkflowStartPostDispatchFailure
		case WorkflowStartRemoteConflictFailure:
			failureKind = WorkflowStartRemoteConflictFailure
		}
		if err := store.FailWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
			RunID: intent.RunID, LeaseToken: intent.LeaseToken, ErrorCode: failureKind, Now: LifecycleNow(),
		}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.logWarn("terminal start intent retirement failed", "run_id", intent.RunID, "error", err)
		}
		return
	}
	input, err := r.DecodeAndValidateWorkflowStartInput(intent, run)
	if err != nil {
		r.PermanentlyFailStartIntent(ctx, store, intent, run, WorkflowStartValidationFailure(intent), err)
		return
	}
	expectedIdentity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		r.PermanentlyFailStartIntent(ctx, store, intent, run, WorkflowStartValidationFailure(intent), err)
		return
	}
	// RequestRunCancellation can retire a lease while this worker is holding a
	// previously leased snapshot. Re-read the durable intent immediately before
	// the external RPC so a cancellation committed first cannot start a workflow.
	if reader, ok := store.(workflowStartIntentReader); ok {
		current, readErr := reader.GetWorkflowStartIntent(ctx, intent.RunID)
		if readErr != nil {
			if errors.Is(readErr, execution.ErrLifecycleLeaseConflict) {
				return
			}
			r.retryStart(ctx, store, intent, "workflow_start_intent_unavailable")
			return
		}
		if current.State != execution.LifecycleIntentStateLeased ||
			current.LeaseToken != intent.LeaseToken {
			return
		}
	}
	if err := store.MarkWorkflowStartDispatchAttempt(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, Now: LifecycleNow(),
	}); err != nil {
		if !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.retryStart(ctx, store, intent, "workflow_start_dispatch_fence_failed")
		}
		return
	}
	intent.DispatchAttempted = true

	startCtx, cancel := context.WithTimeout(
		traceContextForWorkflowStart(ctx, input),
		r.operationTimeout,
	)
	temporalRunID, err := r.starter.StartToolExecutionWorkflow(startCtx, input)
	cancel()
	if err != nil {
		if errors.Is(err, temporalruntime.ErrWorkflowIdentityConflict) {
			r.PermanentlyFailStartIntent(ctx, store, intent, run, WorkflowStartRemoteConflictFailure, err)
			return
		}
		// A timeout, transport failure, or unavailable Temporal response is
		// deliberately retryable: StartWorkflowExecution may already have been
		// accepted by the service.
		r.retryStart(ctx, store, intent, temporalStartErrorCode(err))
		return
	}

	temporalRunID = strings.TrimSpace(temporalRunID)
	if temporalRunID == "" {
		// The starter contract returns only an exact root execution that passed
		// Memo, reset-state, and latest-execution verification.
		r.retryStart(ctx, store, intent, "temporal_start_identity_unavailable")
		return
	}
	if err := store.ConfirmWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, TemporalRunID: temporalRunID, Now: LifecycleNow(),
	}); err != nil {
		if errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.compensateSupersededStart(ctx, store, intent, run, input, expectedIdentity, temporalRunID)
			return
		}
		r.logWarn("temporal start intent confirmation failed", "run_id", intent.RunID, "error", err)
	}
}

func WorkflowStartValidationFailure(intent execution.WorkflowStartIntent) string {
	if intent.DispatchAttempted {
		return WorkflowStartPostDispatchFailure
	}
	return WorkflowStartNotDispatchedFailure
}

func (r *Reconciler) compensateSupersededStart(
	ctx context.Context,
	store execution.RunProjectionStore,
	leased execution.WorkflowStartIntent,
	run execution.DurableRun,
	input temporalruntime.ToolExecutionWorkflowInput,
	expectedIdentity temporalruntime.ToolExecutionWorkflowIdentity,
	temporalRunID string,
) {
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		return
	}
	current, err := reader.GetWorkflowStartIntent(ctx, leased.RunID)
	if err != nil || current.State != execution.LifecycleIntentStateSuperseded {
		return
	}
	currentInput, err := r.DecodeAndValidateWorkflowStartInput(current, run)
	if err != nil {
		return
	}
	currentIdentity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(currentInput)
	if err != nil || currentIdentity != expectedIdentity || currentInput.WorkflowID != input.WorkflowID {
		return
	}
	now := LifecycleNow()
	if _, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RunID: leased.RunID, WorkflowID: input.WorkflowID, TemporalRunID: temporalRunID, Now: now,
	}); err != nil {
		r.logWarn("late workflow start identity binding failed", "run_id", leased.RunID, "error", err)
		return
	}
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RunID: leased.RunID, Reason: "user_requested", Now: now,
	}); errors.Is(err, execution.ErrDurableRunTerminalConflict) {
		return
	} else if err != nil {
		r.logWarn("late workflow start cancellation requeue failed", "run_id", leased.RunID, "error", err)
		return
	}
	latestRun, err := store.GetRun(ctx, leased.RunID)
	if err != nil {
		// The durable cancellation command remains pending and will retry after a
		// readable projection is available. Never send from the stale snapshot.
		r.logWarn("late workflow start pre-cancel projection read failed", "run_id", leased.RunID, "error", err)
		return
	}
	if latestRun.TraceID != run.TraceID || latestRun.ConversationID != run.ConversationID {
		r.logWarn("late workflow start pre-cancel identity changed", "run_id", leased.RunID)
		return
	}
	if temporalRunTerminal(latestRun.Status) && latestRun.Status != execution.DurableRunStatusCanceled {
		// Completion, failure, or expiry won after the cancellation was requested.
		// The winning terminal projection owns cancellation-command convergence.
		return
	}
	cancelCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	err = r.starter.CancelToolExecutionWorkflow(cancelCtx, temporalruntime.ToolExecutionWorkflowCancelInput{
		Reason: "user_requested", RunID: leased.RunID, TemporalRunID: temporalRunID, WorkflowID: input.WorkflowID,
	})
	cancel()
	if err != nil && ctx.Err() == nil {
		r.logWarn("late workflow start cancellation delivery failed", "run_id", leased.RunID, "error", err)
	}
}

func (r *Reconciler) retryStart(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
	code string,
) {
	now := LifecycleNow()
	if err := store.RetryWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, ErrorCode: boundedLifecycleErrorCode(code),
		Now: now, NextAttemptAt: now.Add(lifecycleRetryDelay(intent.AttemptCount)),
	}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal start intent retry persistence failed", "run_id", intent.RunID, "error", err)
	}
}

func (r *Reconciler) PermanentlyFailStartIntent(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
	failureKind string,
	cause error,
) {
	// Both local corruption and a durable remote identity conflict terminalize
	// the product run. Only the local marker proves no RPC was dispatched.
	now := LifecycleNow()
	if run.Status != execution.DurableRunStatusFailed {
		if err := r.finalizer.FailWorkflowStart(ctx, run, failureKind, cause); err != nil {
			r.retryStart(ctx, store, intent, "workflow_start_finalization_failed")
			return
		}
	}
	if err := store.FailWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, ErrorCode: failureKind, Now: now,
	}); err != nil {
		if !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.logWarn("permanent workflow start failure persistence failed", "run_id", intent.RunID, "error", err)
		}
		return
	}
}
