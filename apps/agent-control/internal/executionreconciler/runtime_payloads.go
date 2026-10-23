package executionreconciler

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

// A terminal projection may precede the final Activity acknowledgement. Wait for
// Workflow closure so a retried finalization can still load its saved input.
func (r *Reconciler) ReconcileRuntimePayloads(ctx context.Context) {
	if r.payloads == nil {
		return
	}
	items, err := r.payloads.ListTerminalRuntimePayloads(ctx, r.payloadCursor, temporalReconcileBatch)
	if err != nil {
		if r.logger != nil {
			r.logger.Warn("runtime payload cleanup scan failed", "error", err)
		}
		return
	}
	for _, item := range items {
		r.payloadCursor = item.RequestID
		if item.TemporalRunID != "" {
			reader, ok := r.starter.(executionapplication.WorkflowControl)
			if !ok {
				continue
			}
			info, err := reader.DescribeToolExecutionWorkflow(ctx, item.WorkflowID, item.TemporalRunID)
			if err != nil || (info.Found && (info.Status == execution.WorkflowExecutionStatusRunning || info.Status == "" || info.Status == execution.WorkflowExecutionStatusUnknown)) {
				continue
			}
		}
		if err := r.payloads.DeleteRuntimePayloads(ctx, item.RequestID); err != nil && r.logger != nil {
			r.logger.Warn("runtime payload cleanup failed", "request_id", item.RequestID, "error", err)
		}
	}
	if len(items) < temporalReconcileBatch {
		r.payloadCursor = ""
	}
}
