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

func (r *Reconciler) verifyUnboundRootWorkflowExecutionCandidate(
	ctx context.Context,
	control execution.WorkflowControl,
	workflowID string,
	expected execution.WorkflowIdentity,
	candidate execution.WorkflowExecutionInfo,
) (execution.WorkflowExecutionInfo, bool, error) {
	temporalRunID := strings.TrimSpace(candidate.RunID)
	if temporalRunID == "" || strings.TrimSpace(candidate.FirstRunID) != temporalRunID {
		return execution.WorkflowExecutionInfo{}, false, nil
	}
	probeCtx, cancel := context.WithTimeout(ctx, r.operationTimeout)
	exact, err := control.DescribeToolExecutionWorkflow(probeCtx, workflowID, temporalRunID)
	cancel()
	if err != nil || strings.TrimSpace(exact.RunID) != temporalRunID ||
		strings.TrimSpace(exact.FirstRunID) != temporalRunID {
		return execution.WorkflowExecutionInfo{}, false, nil
	}
	if err := execution.ValidateWorkflowIdentity(exact, expected); err != nil {
		return execution.WorkflowExecutionInfo{}, false, err
	}
	return exact, true, nil
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
