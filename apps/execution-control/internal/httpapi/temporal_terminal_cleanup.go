package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
)

func (s *Server) completeTerminalRunCleanup(
	ctx context.Context,
	run execution.DurableRun,
	leaseToken string,
	now time.Time,
) error {
	if s == nil || s.runProjectionStore == nil {
		return execution.ErrRunProjectionStoreNotConfigured
	}
	if !temporalRunTerminal(run.Status) {
		return errors.New("run cleanup requires a terminal durable run")
	}
	leaseToken = strings.TrimSpace(leaseToken)
	if leaseToken == "" {
		return errors.New("run cleanup requires a lease token")
	}
	if err := s.deleteExecutionInput(ctx, run); err != nil {
		return err
	}
	if err := s.deleteProtectedPayloads(ctx, run); err != nil {
		return err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return s.runProjectionStore.ConfirmRunCleanup(ctx, execution.RunCleanupResult{
		RunID:      run.RunID,
		LeaseToken: leaseToken,
		Now:        now.UTC().Truncate(time.Microsecond),
	})
}

func (r *temporalReconciler) reconcileRunCleanups(ctx context.Context) {
	store := r.store()
	if store == nil {
		return
	}
	now := lifecycleNow()
	token, err := lifecycleLeaseToken("cleanup")
	if err != nil {
		r.logWarn("terminal run cleanup lease token generation failed", "error", err)
		return
	}
	cleanups, err := store.LeaseRunCleanups(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: token,
		Now:        now,
		LeaseUntil: now.Add(temporalIntentLease),
		Limit:      temporalReconcileBatch,
	})
	if err != nil {
		if ctx.Err() == nil {
			r.logWarn("terminal run cleanup lease failed", "error", err)
		}
		return
	}
	for _, cleanup := range cleanups {
		if ctx.Err() != nil {
			return
		}
		r.reconcileRunCleanup(ctx, store, cleanup)
	}
}

func (r *temporalReconciler) reconcileRunCleanup(
	ctx context.Context,
	store execution.RunProjectionStore,
	cleanup execution.RunCleanup,
) {
	run, err := store.GetRun(ctx, cleanup.RunID)
	if err != nil {
		r.retryRunCleanup(ctx, store, cleanup, "cleanup_run_unavailable")
		return
	}
	if !temporalRunTerminal(run.Status) {
		r.retryRunCleanup(ctx, store, cleanup, "cleanup_run_not_terminal")
		return
	}
	reader, ok := store.(workflowStartIntentReader)
	if !ok {
		r.retryRunCleanup(ctx, store, cleanup, "cleanup_start_identity_unavailable")
		return
	}
	start, err := reader.GetWorkflowStartIntent(ctx, run.RunID)
	if err != nil {
		r.retryRunCleanup(ctx, store, cleanup, "cleanup_start_identity_unavailable")
		return
	}
	if cleanupStartHasExecutionBinding(start) {
		if !r.confirmCleanupWorkflowClosed(ctx, run, start) {
			r.retryRunCleanup(ctx, store, cleanup, "cleanup_workflow_not_closed")
			return
		}
	} else if !cleanupStartProvesNoExecution(start) {
		r.retryRunCleanup(ctx, store, cleanup, "cleanup_start_identity_unresolved")
		return
	}
	if err := r.server.completeTerminalRunCleanup(
		ctx,
		run,
		cleanup.LeaseToken,
		lifecycleNow(),
	); err != nil {
		r.retryRunCleanup(ctx, store, cleanup, terminalCleanupErrorCode(err))
	}
}

func (r *temporalReconciler) confirmCleanupWorkflowClosed(
	ctx context.Context,
	run execution.DurableRun,
	start execution.WorkflowStartIntent,
) bool {
	if strings.TrimSpace(start.TemporalRunID) == "" {
		return false
	}
	control, ok := r.server.temporalStarter.(temporalruntime.WorkflowControl)
	if !ok {
		return false
	}
	input, err := decodeAndValidateWorkflowStartInput(start, run)
	if err != nil {
		return false
	}
	expected, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		return false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.server.temporalOperationTimeout())
	exact, err := control.DescribeToolExecutionWorkflow(
		probeCtx,
		start.WorkflowID,
		start.TemporalRunID,
	)
	cancel()
	if err != nil {
		return false
	}
	if strings.TrimSpace(exact.RunID) != strings.TrimSpace(start.TemporalRunID) {
		return false
	}
	if err := temporalruntime.ValidateToolExecutionWorkflowIdentity(exact, expected); err != nil {
		return false
	}
	firstRunID := strings.TrimSpace(exact.FirstRunID)
	if firstRunID == "" || exact.CloseTime.IsZero() || !temporalWorkflowClosedForCleanup(exact.Status) {
		return false
	}
	latest, found := r.describeLatestMatchingBoundWorkflowExecution(
		ctx,
		control,
		start.WorkflowID,
		start.TemporalRunID,
		expected,
		firstRunID,
	)
	if !found {
		return false
	}
	return !latest.CloseTime.IsZero() && temporalWorkflowClosedForCleanup(latest.Status)
}

func temporalWorkflowClosedForCleanup(status enumspb.WorkflowExecutionStatus) bool {
	switch status {
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
		enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
		enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
		enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return true
	default:
		return false
	}
}

func cleanupStartProvesNoExecution(start execution.WorkflowStartIntent) bool {
	if strings.TrimSpace(start.TemporalRunID) != "" || start.DispatchAttempted {
		return false
	}
	switch start.State {
	case execution.LifecycleIntentStatePermanentFailed:
		return start.LastErrorCode == workflowStartNotDispatchedFailure
	case execution.LifecycleIntentStateSuperseded:
		return true
	default:
		return false
	}
}

func cleanupStartHasExecutionBinding(start execution.WorkflowStartIntent) bool {
	if strings.TrimSpace(start.TemporalRunID) == "" {
		return false
	}
	if start.State == execution.LifecycleIntentStateConfirmed {
		return true
	}
	return start.State == execution.LifecycleIntentStateSuperseded && start.DispatchAttempted
}

func (r *temporalReconciler) retryRunCleanup(
	ctx context.Context,
	store execution.RunProjectionStore,
	cleanup execution.RunCleanup,
	code string,
) {
	now := lifecycleNow()
	err := store.RetryRunCleanup(ctx, execution.RunCleanupResult{
		RunID:         cleanup.RunID,
		LeaseToken:    cleanup.LeaseToken,
		ErrorCode:     boundedLifecycleErrorCode(code),
		Now:           now,
		NextAttemptAt: now.Add(lifecycleRetryDelay(cleanup.AttemptCount)),
	})
	if err != nil && !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		r.logWarn("terminal run cleanup retry persistence failed", "run_id", cleanup.RunID, "error", err)
	}
}

func terminalCleanupErrorCode(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		return "cleanup_lease_conflict"
	}
	if executionInputErrorKind(err) != "execution_input_unavailable" {
		return boundedLifecycleErrorCode(executionInputErrorKind(err))
	}
	return "terminal_payload_cleanup_failed"
}
