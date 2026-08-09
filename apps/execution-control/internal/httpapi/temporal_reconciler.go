package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
)

const (
	temporalReconcileInterval = time.Second
	temporalReconcileBatch    = 32
	temporalIntentLease       = 30 * time.Second
	temporalRetryMaximum      = 30 * time.Second

	workflowStartNotDispatchedFailure    = "workflow_start_not_dispatched_invalid"
	workflowStartPostDispatchFailure     = "workflow_start_after_dispatch_invalid"
	workflowStartRemoteConflictFailure   = "workflow_start_remote_identity_conflict"
	workflowExecutionTerminatedFailure   = "workflow_terminated_without_terminal_projection"
	workflowCompletedUnprojectedFailure  = "workflow_completed_without_terminal_projection"
	workflowFailedUnprojectedFailure     = "workflow_failed_without_terminal_projection"
	workflowCanceledUnprojectedFailure   = "workflow_canceled_without_terminal_projection"
	workflowUnauthorizedSuccessorFailure = "workflow_successor_without_authorization"
)

// temporalReconciler owns the non-atomic edges between the durable execution
// projection and Temporal. HTTP handlers only persist intents/commands; this
// loop leases them, retries uncertain RPC outcomes, and records confirmation.
type temporalReconciler struct {
	server               *Server
	cancel               context.CancelFunc
	activeWorkflowCursor string
	wake                 chan struct{}
	wg                   sync.WaitGroup
}

type workflowStartIntentReader interface {
	GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error)
}

type activeWorkflowRunReader interface {
	ListActiveWorkflowRuns(context.Context, string, int) ([]execution.ActiveWorkflowRun, error)
}

func (s *Server) StartTemporalReconciler(parent context.Context) {
	if s == nil || s.runProjectionStore == nil || s.temporalStarter == nil {
		return
	}
	s.temporalReconcilerMu.Lock()
	defer s.temporalReconcilerMu.Unlock()
	if s.temporalReconciler != nil {
		return
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	reconciler := &temporalReconciler{server: s, cancel: cancel, wake: make(chan struct{}, 1)}
	s.temporalReconciler = reconciler
	reconciler.wg.Add(1)
	go reconciler.loop(ctx)
}

func (s *Server) StopTemporalReconciler() {
	if s == nil {
		return
	}
	s.temporalReconcilerMu.Lock()
	reconciler := s.temporalReconciler
	s.temporalReconciler = nil
	s.temporalReconcilerMu.Unlock()
	if reconciler == nil {
		return
	}
	reconciler.cancel()
	reconciler.wg.Wait()
}

// ReconcileTemporalRunsOnce is intentionally exported for operational probes
// and focused tests; the production loop calls the same implementation.
func (s *Server) ReconcileTemporalRunsOnce(ctx context.Context) {
	if s == nil || s.runProjectionStore == nil || s.temporalStarter == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	(&temporalReconciler{server: s}).reconcile(ctx)
}

func (r *temporalReconciler) loop(ctx context.Context) {
	defer r.wg.Done()
	r.reconcile(ctx)
	ticker := time.NewTicker(temporalReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.wake:
			r.reconcile(ctx)
		case <-ticker.C:
			r.reconcile(ctx)
		}
	}
}

func (s *Server) wakeTemporalReconciler() {
	if s == nil {
		return
	}
	s.temporalReconcilerMu.Lock()
	defer s.temporalReconcilerMu.Unlock()
	if s.temporalReconciler == nil || s.temporalReconciler.wake == nil {
		return
	}
	select {
	case s.temporalReconciler.wake <- struct{}{}:
	default:
	}
}

func (r *temporalReconciler) reconcile(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	// Cancellation wins start whenever both intents are present. The store
	// also supersedes a pending start atomically when the cancel command is
	// written, so this ordering only reduces the race window for leased work.
	r.reconcileCancellations(ctx)
	r.reconcileStarts(ctx)
	r.reconcileWorkflowTimeouts(ctx)
}

func (r *temporalReconciler) reconcileWorkflowTimeouts(ctx context.Context) {
	store := r.store()
	reader, readerOK := store.(activeWorkflowRunReader)
	control, controlOK := r.server.temporalStarter.(temporalruntime.WorkflowControl)
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
		r.activeWorkflowCursor = binding.Run.RunID
	}
	if len(bindings) < temporalReconcileBatch {
		r.activeWorkflowCursor = ""
	}
}

func (r *temporalReconciler) reconcileWorkflowTimeout(
	ctx context.Context,
	store execution.RunProjectionStore,
	control temporalruntime.WorkflowControl,
	binding execution.ActiveWorkflowRun,
) {
	input, decodeErr := decodeAndValidateWorkflowStartInput(binding.StartIntent, binding.Run)
	if decodeErr != nil {
		r.logWarn("confirmed Temporal workflow identity is invalid", "run_id", binding.Run.RunID, "error", decodeErr)
		return
	}
	expected, identityErr := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if identityErr != nil {
		return
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
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
			r.logWarn("confirmed Temporal workflow identity conflict", "run_id", binding.Run.RunID)
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
			r.logWarn("Temporal workflow timeout finalization failed", "run_id", binding.Run.RunID, "error", err)
		}
	case enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED:
		if info.CloseTime.IsZero() {
			return
		}
		if err := r.finalizeTerminatedWorkflow(ctx, store, binding.Run, info.CloseTime); err != nil && ctx.Err() == nil {
			r.logWarn("Temporal workflow termination finalization failed", "run_id", binding.Run.RunID, "error", err)
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
				"run_id", binding.Run.RunID,
				"status", info.Status.String(),
				"error", err,
			)
		}
	}
}

func (r *temporalReconciler) finalizeTimedOutWorkflow(
	ctx context.Context,
	store execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	latest, err := store.GetRun(ctx, run.RunID)
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
		FailureHash:     lifecycleErrorHash(failureKind),
		FailureKind:     failureKind,
		FailCloseReason: failureKind,
		ProjectionRef:   temporalProjectionRef(run.RunID, "workflow/execution"),
		ResultKind:      "workflow_timeout",
		StepID:          "workflow.execution",
		StepKind:        "workflow",
		TaskQueue:       run.TaskQueue,
		TimeoutOutcome:  execution.TimeoutOutcomeWorkflowTimeout,
	}
	if err := r.server.projectTemporalFailureStep(ctx, latest, projection, context.DeadlineExceeded); err != nil {
		return err
	}
	writeProductFinalization := r.server.productFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = r.server.writeChatProductFinalization
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
	_, err = store.ExpireRunProjection(ctx, execution.DurableRunExpireRequest{
		RunID: latest.RunID,
		Now:   expiredAt,
	})
	if err != nil {
		return err
	}
	return nil
}

func (r *temporalReconciler) finalizeTerminatedWorkflow(
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
		workflowExecutionTerminatedFailure,
	)
}

func (r *temporalReconciler) finalizeClosedWorkflowFailure(
	ctx context.Context,
	store execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
	failureKind string,
) error {
	latest, err := store.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	if latest.TraceID != run.TraceID || latest.ConversationID != run.ConversationID {
		return errors.New("workflow termination durable identity changed")
	}
	failedAt := closedAt.UTC().Truncate(time.Microsecond)
	projection := temporalStepFailureProjection{
		FailedAt:        failedAt,
		FailureHash:     lifecycleErrorHash(failureKind),
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
		// A terminal replay may only verify the canonical failed aggregate and
		// event. It must not synthesize missing step evidence after the fact.
		_, err := r.server.failTemporalRun(ctx, latest, projection, cause)
		return err
	}
	if err := r.server.projectTemporalFailureStep(ctx, latest, projection, cause); err != nil {
		return err
	}
	_, err = r.server.failTemporalRun(ctx, latest, projection, cause)
	return err
}

func workflowClosedWithoutProjectionFailure(status enumspb.WorkflowExecutionStatus) (string, bool) {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED:
		return workflowCompletedUnprojectedFailure, true
	case enumspb.WORKFLOW_EXECUTION_STATUS_FAILED:
		return workflowFailedUnprojectedFailure, true
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		return workflowCanceledUnprojectedFailure, true
	default:
		return "", false
	}
}

func (r *temporalReconciler) reconcileStarts(ctx context.Context) {
	store := r.store()
	if store == nil {
		return
	}
	now := lifecycleNow()
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
		r.reconcileStartIntent(ctx, store, intent)
	}
}

func (r *temporalReconciler) reconcileStartIntent(
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
		case workflowStartNotDispatchedFailure:
			failureKind = workflowStartNotDispatchedFailure
		case workflowStartPostDispatchFailure:
			failureKind = workflowStartPostDispatchFailure
		case workflowStartRemoteConflictFailure:
			failureKind = workflowStartRemoteConflictFailure
		}
		if err := store.FailWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
			RunID: intent.RunID, LeaseToken: intent.LeaseToken, ErrorCode: failureKind, Now: lifecycleNow(),
		}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.logWarn("terminal start intent retirement failed", "run_id", intent.RunID, "error", err)
		}
		return
	}
	input, err := decodeAndValidateWorkflowStartInput(intent, run)
	if err != nil {
		r.permanentlyFailStartIntent(ctx, store, intent, run, workflowStartValidationFailure(intent), err)
		return
	}
	expectedIdentity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		r.permanentlyFailStartIntent(ctx, store, intent, run, workflowStartValidationFailure(intent), err)
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
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, Now: lifecycleNow(),
	}); err != nil {
		if !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.retryStart(ctx, store, intent, "workflow_start_dispatch_fence_failed")
		}
		return
	}
	intent.DispatchAttempted = true

	startCtx, cancel := context.WithTimeout(
		traceContextForWorkflowStart(ctx, input),
		r.server.temporalOperationTimeout(),
	)
	temporalRunID, err := r.server.temporalStarter.StartToolExecutionWorkflow(startCtx, input)
	cancel()
	if err != nil {
		if errors.Is(err, temporalruntime.ErrWorkflowIdentityConflict) {
			r.permanentlyFailStartIntent(ctx, store, intent, run, workflowStartRemoteConflictFailure, err)
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
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, TemporalRunID: temporalRunID, Now: lifecycleNow(),
	}); err != nil {
		if errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			r.compensateSupersededStart(ctx, store, intent, run, input, expectedIdentity, temporalRunID)
			return
		}
		r.logWarn("temporal start intent confirmation failed", "run_id", intent.RunID, "error", err)
	}
}

func workflowStartValidationFailure(intent execution.WorkflowStartIntent) string {
	if intent.DispatchAttempted {
		return workflowStartPostDispatchFailure
	}
	return workflowStartNotDispatchedFailure
}

func (r *temporalReconciler) compensateSupersededStart(
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
	currentInput, err := decodeAndValidateWorkflowStartInput(current, run)
	if err != nil {
		return
	}
	currentIdentity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(currentInput)
	if err != nil || currentIdentity != expectedIdentity || currentInput.WorkflowID != input.WorkflowID {
		return
	}
	now := lifecycleNow()
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
	cancelCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	err = r.server.temporalStarter.CancelToolExecutionWorkflow(cancelCtx, temporalruntime.ToolExecutionWorkflowCancelInput{
		Reason: "user_requested", RunID: leased.RunID, TemporalRunID: temporalRunID, WorkflowID: input.WorkflowID,
	})
	cancel()
	if err != nil && ctx.Err() == nil {
		r.logWarn("late workflow start cancellation delivery failed", "run_id", leased.RunID, "error", err)
	}
}

func (r *temporalReconciler) reconcileCancellations(ctx context.Context) {
	store := r.store()
	if store == nil {
		return
	}
	now := lifecycleNow()
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
		r.reconcileCancellationCommand(ctx, store, command)
	}
}

func (r *temporalReconciler) reconcileCancellationCommand(
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

	control, ok := r.server.temporalStarter.(temporalruntime.WorkflowControl)
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
	input, err := decodeAndValidateWorkflowStartInput(startIntent, run)
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
	probeCtx, probeCancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
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
				TemporalRunID: temporalRunID, Now: lifecycleNow(),
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

	cancelCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	err = r.server.temporalStarter.CancelToolExecutionWorkflow(cancelCtx, temporalruntime.ToolExecutionWorkflowCancelInput{
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
	probeCtx, probeCancel = context.WithTimeout(ctx, r.server.temporalOperationTimeout())
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

func (r *temporalReconciler) cancellationStillOwnsActiveRun(
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

func (r *temporalReconciler) ensureSupersededWorkflowStartForCancellation(
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
	recoveryStarter, ok := r.server.temporalStarter.(temporalruntime.WorkflowCancellationRecoveryStarter)
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
		r.server.temporalOperationTimeout(),
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
	probeCtx, probeCancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
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
		Now:           lifecycleNow(),
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

func (r *temporalReconciler) reconcileClosedWorkflowCancellation(
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

func (r *temporalReconciler) finalizeCancellationLocally(
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
	_, finalizeErr := r.server.FinalizeExecutionCancellationActivity(finalizeCtx, temporalruntime.FinalizeExecutionCancellationActivityInput{
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

func (r *temporalReconciler) confirmCancellation(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
) bool {
	err := store.ConfirmRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RunID: command.RunID, LeaseToken: command.LeaseToken, Now: lifecycleNow(),
	})
	if err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation confirmation failed", "run_id", command.RunID, "error", err)
	}
	return err == nil
}

func (r *temporalReconciler) retryStart(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
	code string,
) {
	now := lifecycleNow()
	if err := store.RetryWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, ErrorCode: boundedLifecycleErrorCode(code),
		Now: now, NextAttemptAt: now.Add(lifecycleRetryDelay(intent.AttemptCount)),
	}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal start intent retry persistence failed", "run_id", intent.RunID, "error", err)
	}
}

func (r *temporalReconciler) retryCancellation(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
	code string,
) {
	now := lifecycleNow()
	if err := store.RetryRunCancellationCommand(ctx, execution.RunCancellationCommandResult{
		RunID: command.RunID, LeaseToken: command.LeaseToken, ErrorCode: boundedLifecycleErrorCode(code),
		Now: now, NextAttemptAt: now.Add(lifecycleRetryDelay(command.AttemptCount)),
	}); err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("temporal cancellation retry persistence failed", "run_id", command.RunID, "error", err)
	}
}

func (r *temporalReconciler) permanentlyFailStartIntent(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
	failureKind string,
	cause error,
) {
	// Both local corruption and a durable remote identity conflict terminalize
	// the product run. Only the local marker proves no RPC was dispatched.
	now := lifecycleNow()
	failureHash := lifecycleErrorHash(failureKind)
	if run.Status != execution.DurableRunStatusFailed {
		projection := temporalStepFailureProjection{
			FailedAt:        now,
			FailureHash:     failureHash,
			FailureKind:     failureKind,
			ProjectionRef:   temporalProjectionRef(run.RunID, "workflow/start"),
			ResultKind:      "activity_failure",
			StepID:          "workflow.start",
			StepKind:        "workflow",
			TaskQueue:       temporalruntime.WorkflowTaskQueue,
			FailCloseReason: failureKind,
		}
		if err := r.server.projectTemporalFailureStep(ctx, run, projection, cause); err != nil {
			r.retryStart(ctx, store, intent, "workflow_start_finalization_failed")
			return
		}
		failedRun, err := r.server.failTemporalRun(ctx, run, projection, cause)
		if err != nil {
			r.retryStart(ctx, store, intent, "workflow_start_finalization_failed")
			return
		}
		run = failedRun
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

func decodeAndValidateWorkflowStartInput(
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
) (temporalruntime.ToolExecutionWorkflowInput, error) {
	var input temporalruntime.ToolExecutionWorkflowInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		return input, fmt.Errorf("workflow input JSON is invalid: %w", err)
	}
	if input.RunID != run.RunID || input.RequestID != run.RequestID || input.TraceID != run.TraceID ||
		input.TurnID != run.TurnID || input.ConversationID != run.ConversationID {
		return input, errors.New("workflow input identity does not match durable run")
	}
	wantWorkflowID := "campus-agent.chat." + run.RunID
	if input.WorkflowID != wantWorkflowID || intent.WorkflowID != wantWorkflowID {
		return input, errors.New("workflow identity is not canonical")
	}
	if input.TaskQueue != temporalruntime.WorkflowTaskQueue || intent.TaskQueue != temporalruntime.WorkflowTaskQueue {
		return input, errors.New("workflow task queue is not v3")
	}
	if input.PayloadSHA256 != intent.PayloadSHA256 || !validTemporalFailureHash(input.PayloadSHA256) {
		return input, errors.New("workflow input payload hash is invalid")
	}
	if err := validateAdmissionSnapshotForVisibleTools(
		input.AdmissionSnapshot,
		input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames,
	); err != nil {
		return input, fmt.Errorf("workflow admission snapshot is invalid: %w", err)
	}
	return input, nil
}

func traceContextForWorkflowStart(ctx context.Context, input temporalruntime.ToolExecutionWorkflowInput) context.Context {
	traceParent := strings.TrimSpace(input.TraceParent)
	if traceParent == "" {
		return ctx
	}
	headers := http.Header{}
	headers.Set("traceparent", traceParent)
	return telemetry.ExtractIncomingContext(ctx, headers)
}

func temporalWorkflowTerminal(status enumspb.WorkflowExecutionStatus) bool {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW,
		enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return true
	default:
		return false
	}
}

func (r *temporalReconciler) failCloseUnauthorizedWorkflowSuccessor(
	ctx context.Context,
	store execution.RunProjectionStore,
	control temporalruntime.WorkflowControl,
	run execution.DurableRun,
	start execution.WorkflowStartIntent,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	exact temporalruntime.WorkflowExecutionInfo,
	command *execution.RunCancellationCommand,
) bool {
	if exact.CloseTime.IsZero() || strings.TrimSpace(exact.RunID) == "" ||
		strings.TrimSpace(exact.FirstRunID) != strings.TrimSpace(exact.RunID) {
		return false
	}
	if _, found := r.describeMatchingWorkflowSuccessor(
		ctx,
		control,
		start.WorkflowID,
		exact.RunID,
		expected,
	); !found {
		return false
	}
	if command != nil && !r.confirmCancellation(ctx, store, *command) {
		return true
	}
	if err := r.finalizeClosedWorkflowFailure(
		ctx,
		store,
		run,
		exact.CloseTime,
		workflowUnauthorizedSuccessorFailure,
	); err != nil && ctx.Err() == nil {
		r.logWarn("unauthorized Temporal workflow successor fail-close failed", "run_id", run.RunID, "error", err)
	}
	return true
}

func (r *temporalReconciler) describeMatchingWorkflowSuccessor(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	rootTemporalRunID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	rootTemporalRunID = strings.TrimSpace(rootTemporalRunID)
	if rootTemporalRunID == "" {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) == "" ||
		strings.TrimSpace(latest.RunID) == rootTemporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != rootTemporalRunID ||
		!temporalWorkflowMemoIdentityMatches(latest, expected) {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func temporalWorkflowMemoIdentityMatches(
	info temporalruntime.WorkflowExecutionInfo,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
) bool {
	return info.Found && strings.TrimSpace(info.WorkflowID) == expected.WorkflowID &&
		info.IdentityState == temporalruntime.WorkflowIdentityKnown && info.Identity == expected
}

func (r *temporalReconciler) verifyUnboundRootWorkflowExecutionCandidate(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	candidate temporalruntime.WorkflowExecutionInfo,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	temporalRunID := strings.TrimSpace(candidate.RunID)
	if temporalRunID == "" || strings.TrimSpace(candidate.FirstRunID) != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(candidate, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	exact, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, temporalRunID)
	cancel()
	if err != nil || strings.TrimSpace(exact.RunID) != temporalRunID ||
		strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(exact, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return r.describeLatestMatchingBoundWorkflowExecution(
		ctx,
		control,
		workflowID,
		temporalRunID,
		expected,
		temporalRunID,
	)
}

func (r *temporalReconciler) describeLatestMatchingBoundWorkflowExecution(
	ctx context.Context,
	control temporalruntime.WorkflowControl,
	workflowID string,
	temporalRunID string,
	expected temporalruntime.ToolExecutionWorkflowIdentity,
	firstRunID string,
) (temporalruntime.WorkflowExecutionInfo, bool) {
	temporalRunID = strings.TrimSpace(temporalRunID)
	firstRunID = strings.TrimSpace(firstRunID)
	if temporalRunID == "" || firstRunID != temporalRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) != temporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != firstRunID {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(latest, expected); err != nil {
		return temporalruntime.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func lifecycleNow() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }

func (s *Server) temporalOperationTimeout() time.Duration {
	if s == nil || s.config.TemporalStartTimeoutMS <= 0 {
		return 5 * time.Second
	}
	return time.Duration(s.config.TemporalStartTimeoutMS) * time.Millisecond
}

func lifecycleLeaseToken(prefix string) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return strings.TrimSpace(prefix) + "-" + hex.EncodeToString(bytes), nil
}

func lifecycleRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	delay := time.Second << (attempt - 1)
	if delay > temporalRetryMaximum {
		return temporalRetryMaximum
	}
	return delay
}

func boundedLifecycleErrorCode(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return "temporal_reconciliation_failed"
	}
	if len(code) > 64 {
		return code[:64]
	}
	for _, char := range code {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return "temporal_reconciliation_failed"
	}
	return code
}

func temporalStartErrorCode(err error) string {
	if err == nil {
		return ""
	}
	return "temporal_workflow_start_uncertain"
}

func lifecycleErrorHash(code string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(digest[:])
}

func (r *temporalReconciler) store() execution.RunProjectionStore {
	if r == nil || r.server == nil {
		return nil
	}
	return r.server.runProjectionStore
}

func (r *temporalReconciler) logWarn(_ string, args ...any) {
	if r != nil && r.server != nil && r.server.logger != nil {
		attributes := []any{
			"event_type", "execution_control.reconciliation_warning",
			"status", "failed",
			"failure_kind", "temporal_reconciliation_failed",
			"source", "temporal_reconciler",
		}
		for index := 0; index+1 < len(args); index += 2 {
			if key, ok := args[index].(string); ok && key == "run_id" {
				attributes = append(attributes, key, args[index+1])
			}
		}
		r.server.logger.Warn("execution_control.reconciliation_warning", attributes...)
	}
}
