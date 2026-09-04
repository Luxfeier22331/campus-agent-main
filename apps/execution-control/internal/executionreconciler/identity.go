package executionreconciler

import (
	"context"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func traceContextForWorkflowStart(ctx context.Context, input execution.WorkflowStartInput) context.Context {
	traceParent := strings.TrimSpace(input.TraceParent)
	if traceParent == "" {
		return ctx
	}
	return telemetry.ExtractTraceParent(ctx, traceParent)
}

func temporalWorkflowTerminal(status execution.WorkflowExecutionStatus) bool {
	return status.Terminal()
}

func (r *Reconciler) failCloseUnauthorizedWorkflowSuccessor(
	ctx context.Context,
	store execution.RunProjectionStore,
	control execution.WorkflowControl,
	run execution.DurableRun,
	start execution.WorkflowStartIntent,
	expected execution.WorkflowIdentity,
	exact execution.WorkflowExecutionInfo,
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
		WorkflowUnauthorizedSuccessorFailure,
	); err != nil && ctx.Err() == nil {
		r.logWarn("unauthorized Temporal workflow successor fail-close failed", "request_id", run.RequestID, "error", err)
	}
	return true
}

func (r *Reconciler) describeMatchingWorkflowSuccessor(
	ctx context.Context,
	control execution.WorkflowControl,
	workflowID string,
	rootTemporalRunID string,
	expected execution.WorkflowIdentity,
) (execution.WorkflowExecutionInfo, bool) {
	rootTemporalRunID = strings.TrimSpace(rootTemporalRunID)
	if rootTemporalRunID == "" {
		return execution.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) == "" ||
		strings.TrimSpace(latest.RunID) == rootTemporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != rootTemporalRunID ||
		!temporalWorkflowMemoIdentityMatches(latest, expected) {
		return execution.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func temporalWorkflowMemoIdentityMatches(
	info execution.WorkflowExecutionInfo,
	expected execution.WorkflowIdentity,
) bool {
	return info.Found && strings.TrimSpace(info.WorkflowID) == expected.WorkflowID &&
		info.IdentityState == execution.WorkflowIdentityKnown && info.Identity == expected
}

func (r *Reconciler) verifyUnboundRootWorkflowExecutionCandidate(
	ctx context.Context,
	control execution.WorkflowControl,
	workflowID string,
	expected execution.WorkflowIdentity,
	candidate execution.WorkflowExecutionInfo,
) (execution.WorkflowExecutionInfo, bool) {
	temporalRunID := strings.TrimSpace(candidate.RunID)
	if temporalRunID == "" || strings.TrimSpace(candidate.FirstRunID) != temporalRunID {
		return execution.WorkflowExecutionInfo{}, false
	}
	if err := execution.ValidateWorkflowIdentity(candidate, expected); err != nil {
		return execution.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	exact, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, temporalRunID)
	cancel()
	if err != nil || strings.TrimSpace(exact.RunID) != temporalRunID ||
		strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		return execution.WorkflowExecutionInfo{}, false
	}
	if err := execution.ValidateWorkflowIdentity(exact, expected); err != nil {
		return execution.WorkflowExecutionInfo{}, false
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

func (r *Reconciler) describeLatestMatchingBoundWorkflowExecution(
	ctx context.Context,
	control execution.WorkflowControl,
	workflowID string,
	temporalRunID string,
	expected execution.WorkflowIdentity,
	firstRunID string,
) (execution.WorkflowExecutionInfo, bool) {
	temporalRunID = strings.TrimSpace(temporalRunID)
	firstRunID = strings.TrimSpace(firstRunID)
	if temporalRunID == "" || firstRunID != temporalRunID {
		return execution.WorkflowExecutionInfo{}, false
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	latest, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, "")
	cancel()
	if err != nil || !latest.Found || strings.TrimSpace(latest.RunID) != temporalRunID ||
		strings.TrimSpace(latest.FirstRunID) != firstRunID {
		return execution.WorkflowExecutionInfo{}, false
	}
	if err := execution.ValidateWorkflowIdentity(latest, expected); err != nil {
		return execution.WorkflowExecutionInfo{}, false
	}
	return latest, true
}

func temporalRunTerminal(status execution.DurableRunStatus) bool {
	switch status {
	case execution.DurableRunStatusCompleted,
		execution.DurableRunStatusFailed,
		execution.DurableRunStatusCanceled,
		execution.DurableRunStatusExpired:
		return true
	default:
		return false
	}
}
