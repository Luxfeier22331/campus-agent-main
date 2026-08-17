package httpapi

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	temporalReconcileBatch               = 32
	workflowStartNotDispatchedFailure    = executionreconciler.WorkflowStartNotDispatchedFailure
	workflowStartPostDispatchFailure     = executionreconciler.WorkflowStartPostDispatchFailure
	workflowStartRemoteConflictFailure   = executionreconciler.WorkflowStartRemoteConflictFailure
	workflowExecutionTerminatedFailure   = executionreconciler.WorkflowExecutionTerminatedFailure
	workflowCompletedUnprojectedFailure  = executionreconciler.WorkflowCompletedUnprojectedFailure
	workflowFailedUnprojectedFailure     = executionreconciler.WorkflowFailedUnprojectedFailure
	workflowCanceledUnprojectedFailure   = executionreconciler.WorkflowCanceledUnprojectedFailure
	workflowUnauthorizedSuccessorFailure = executionreconciler.WorkflowUnauthorizedSuccessorFailure
)

type temporalReconciler struct {
	delegate *executionreconciler.Reconciler
	server   *Server
}

func (r *temporalReconciler) runtime() *executionreconciler.Reconciler {
	if r.delegate == nil {
		r.delegate = r.server.newExecutionReconciler()
	}
	return r.delegate
}

func (r *temporalReconciler) reconcileStarts(ctx context.Context) {
	r.runtime().ReconcileStarts(ctx)
}

func (r *temporalReconciler) reconcileStartIntent(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
) {
	r.runtime().ReconcileStartIntent(ctx, store, intent)
}

func (r *temporalReconciler) permanentlyFailStartIntent(
	ctx context.Context,
	store execution.RunProjectionStore,
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
	failureKind string,
	cause error,
) {
	r.runtime().PermanentlyFailStartIntent(ctx, store, intent, run, failureKind, cause)
}

func (r *temporalReconciler) reconcileCancellationCommand(
	ctx context.Context,
	store execution.RunProjectionStore,
	command execution.RunCancellationCommand,
) {
	r.runtime().ReconcileCancellationCommand(ctx, store, command)
}

func (r *temporalReconciler) reconcileWorkflowTimeouts(ctx context.Context) {
	r.runtime().ReconcileWorkflowTimeouts(ctx)
}

func (r *temporalReconciler) finalizeTerminatedWorkflow(
	ctx context.Context,
	_ execution.RunProjectionStore,
	run execution.DurableRun,
	closedAt time.Time,
) error {
	return r.server.FinalizeWorkflowClosure(
		ctx,
		run,
		closedAt,
		executionreconciler.WorkflowExecutionTerminatedFailure,
	)
}

func (s *Server) ReconcileTemporalRunsOnce(ctx context.Context) {
	s.newExecutionReconciler().ReconcileOnce(ctx)
}

func lifecycleNow() time.Time {
	return executionreconciler.LifecycleNow()
}

func workflowStartValidationFailure(
	intent execution.WorkflowStartIntent,
) string {
	return executionreconciler.WorkflowStartValidationFailure(intent)
}

func decodeAndValidateWorkflowStartInput(
	intent execution.WorkflowStartIntent,
	run execution.DurableRun,
) (temporalruntime.ToolExecutionWorkflowInput, error) {
	return (&Server{}).newExecutionReconciler().DecodeAndValidateWorkflowStartInput(intent, run)
}
