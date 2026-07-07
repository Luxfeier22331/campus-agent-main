package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func (s *Server) recordRuntimeDecision(request execution.AnswerExecutionRequest) {
	s.metrics.RecordRuntimeDecision(observability.RuntimeDecisionLabels{
		Target:                request.RequestedTool,
		TaskQueue:             request.TaskQueue,
		ScopeGate:             request.RuntimeDecisions.ScopeGateDecision,
		PolicyGate:            request.RuntimeDecisions.PolicyGateDecision,
		ContextPreflightState: request.RuntimeDecisions.ContextPreflightState,
		RoutingNextAction:     request.RuntimeDecisions.RoutingNextAction,
		PlanningOutcome:       request.RuntimeDecisions.PlanningOutcome,
		SelectedTool:          request.RuntimeDecisions.SelectedTool,
		TerminalOutcome:       request.RuntimeDecisions.TerminalOutcome,
		FailCloseReason:       request.RuntimeDecisions.FailCloseReason,
	})
}

func runtimeTelemetryEvent(
	event telemetry.Event,
	request execution.AnswerExecutionRequest,
) telemetry.Event {
	event.ConversationID = request.ConversationID
	event.ContextPreflightState = request.RuntimeDecisions.ContextPreflightState
	event.PlanningOutcome = request.RuntimeDecisions.PlanningOutcome
	event.PolicyGateDecision = request.RuntimeDecisions.PolicyGateDecision
	event.RoutingNextAction = request.RuntimeDecisions.RoutingNextAction
	event.ScopeGateDecision = request.RuntimeDecisions.ScopeGateDecision
	event.SelectedTool = request.RuntimeDecisions.SelectedTool
	event.TaskQueue = request.RuntimeDecisions.TaskQueue
	event.TerminalOutcome = request.RuntimeDecisions.TerminalOutcome
	event.FailCloseReason = request.RuntimeDecisions.FailCloseReason
	event.UserID = request.OwnerUserID
	return event
}

func (s *Server) runtimeTelemetryEvent(
	event telemetry.Event,
	request execution.AnswerExecutionRequest,
) telemetry.Event {
	event = runtimeTelemetryEvent(event, request)
	if strings.TrimSpace(event.Release) == "" {
		event.Release = strings.TrimSpace(s.config.RuntimeRelease)
	}
	if strings.TrimSpace(event.DeploymentEnvironment) == "" {
		event.DeploymentEnvironment = strings.TrimSpace(s.config.DeploymentEnvironment)
	}
	return event
}

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
