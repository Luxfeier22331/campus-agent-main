package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
)

func (s *Server) emitExecutionRunAuditEvent(
	run execution.DurableRun,
	event executionaudit.Event,
) {
	if s == nil || s.executionAudit == nil {
		return
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	event.RequestID = strings.TrimSpace(firstNonEmptyText(event.RequestID, run.RequestID))
	event.RequestedTool = strings.TrimSpace(firstNonEmptyText(event.RequestedTool, run.RequestedTool))
	event.TaskQueue = strings.TrimSpace(firstNonEmptyText(event.TaskQueue, run.TaskQueue))
	event.TraceID = strings.TrimSpace(firstNonEmptyText(event.TraceID, run.TraceID))
	if !run.QueuedAt.IsZero() && event.QueueWait <= 0 {
		event.QueueWait = run.QueuedAt.Sub(run.CreatedAt)
	}
	if !run.CompletedAt.IsZero() && event.Duration <= 0 {
		event.Duration = run.CompletedAt.Sub(run.CreatedAt)
	}
	_ = s.executionAudit.Emit(context.Background(), event)
}

func executionAuditEventTypeForFailure(
	ctx context.Context,
	projection temporalStepFailureProjection,
	cause error,
) string {
	timeoutOutcome := temporalFailureTimeoutOutcome(ctx, projection.TimeoutOutcome, cause)
	if timeoutOutcome != execution.TimeoutOutcomeNotTimedOut {
		return "execution.timed_out"
	}
	return "execution.activity_failed"
}
