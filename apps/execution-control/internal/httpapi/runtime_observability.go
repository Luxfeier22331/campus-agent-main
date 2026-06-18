package httpapi

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
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
		SelectedCapability:    request.RuntimeDecisions.SelectedCapability,
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
	event.SelectedCapability = request.RuntimeDecisions.SelectedCapability
	event.SelectedTool = request.RuntimeDecisions.SelectedTool
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

func runtimeAuditEvent(
	event executionaudit.Event,
	request execution.AnswerExecutionRequest,
) executionaudit.Event {
	event.ContextPreflightState = request.RuntimeDecisions.ContextPreflightState
	event.PlanningOutcome = request.RuntimeDecisions.PlanningOutcome
	event.PolicyGateDecision = request.RuntimeDecisions.PolicyGateDecision
	event.RoutingNextAction = request.RuntimeDecisions.RoutingNextAction
	event.ScopeGateDecision = request.RuntimeDecisions.ScopeGateDecision
	event.SelectedCapability = request.RuntimeDecisions.SelectedCapability
	event.SelectedTool = request.RuntimeDecisions.SelectedTool
	event.TerminalOutcome = request.RuntimeDecisions.TerminalOutcome
	event.FailCloseReason = request.RuntimeDecisions.FailCloseReason
	return event
}
