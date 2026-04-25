package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

func (s *Server) recordRuntimeDecision(request execution.AnswerExecutionRequest) {
	s.metrics.RecordRuntimeDecision(observability.RuntimeDecisionLabels{
		Capability:            request.RequestedCapability,
		Lane:                  request.Lane,
		ScopeGate:             request.RuntimeDecisions.ScopeGateDecision,
		PolicyGate:            request.RuntimeDecisions.PolicyGateDecision,
		ContextPreflightState: request.RuntimeDecisions.ContextPreflightState,
		RoutingNextAction:     request.RuntimeDecisions.RoutingNextAction,
		PlanningOutcome:       request.RuntimeDecisions.PlanningOutcome,
		SelectedTarget:        request.RuntimeDecisions.SelectedTarget,
		SelectedTool:          request.RuntimeDecisions.SelectedTool,
		TerminalOutcome:       request.RuntimeDecisions.TerminalOutcome,
		FailCloseReason:       request.RuntimeDecisions.FailCloseReason,
	})
}

func runtimeTelemetryEvent(
	event telemetry.Event,
	request execution.AnswerExecutionRequest,
) telemetry.Event {
	event.ContextPreflightState = request.RuntimeDecisions.ContextPreflightState
	event.PlanningOutcome = request.RuntimeDecisions.PlanningOutcome
	event.PolicyGateDecision = request.RuntimeDecisions.PolicyGateDecision
	event.RoutingNextAction = request.RuntimeDecisions.RoutingNextAction
	event.ScopeGateDecision = request.RuntimeDecisions.ScopeGateDecision
	event.SelectedTarget = request.RuntimeDecisions.SelectedTarget
	event.SelectedTool = request.RuntimeDecisions.SelectedTool
	event.TerminalOutcome = request.RuntimeDecisions.TerminalOutcome
	event.FailCloseReason = request.RuntimeDecisions.FailCloseReason
	return event
}

func runtimeAuditEvent(
	event executionaudit.Event,
	request execution.AnswerExecutionRequest,
) executionaudit.Event {
	event.ContextPreflightState = request.RuntimeDecisions.ContextPreflightState
	event.PlanningOutcome = request.RuntimeDecisions.PlanningOutcome
	event.PolicyGateDecision = request.RuntimeDecisions.PolicyGateDecision
	event.RoutingNextAction = request.RuntimeDecisions.RoutingNextAction
	event.ScopeGateDecision = request.RuntimeDecisions.ScopeGateDecision
	event.SelectedTarget = request.RuntimeDecisions.SelectedTarget
	event.SelectedTool = request.RuntimeDecisions.SelectedTool
	event.TerminalOutcome = request.RuntimeDecisions.TerminalOutcome
	event.FailCloseReason = request.RuntimeDecisions.FailCloseReason
	return event
}
