package execution

import (
	"encoding/json"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type IntentEvalObservation struct {
	Capability             string   `json:"capability"`
	TaskKind               string   `json:"task_kind"`
	LaunchState            string   `json:"launch_state"`
	NextAction             string   `json:"next_action"`
	ScopeClass             string   `json:"scope_class"`
	PolicyReason           string   `json:"policy_reason"`
	ScopeReason            string   `json:"scope_reason"`
	SelectedCapability     string   `json:"selected_capability"`
	AllowedTools           []string `json:"allowed_tools"`
	ClassifierVersion      string   `json:"classifier_version"`
	SchemaVersion          string   `json:"schema_version"`
	ContextResolutionState string   `json:"context_resolution_state"`
	ContextReferenceType   string   `json:"context_reference_type"`
	MissingSlots           []string `json:"missing_slots"`
	PlanningOutcome        string   `json:"planning_outcome"`
	TerminalStatus         string   `json:"terminal_status"`
	ErrorCode              string   `json:"error_code"`
}

type intentEvalBridgePayload struct {
	RuntimeDecisions struct {
		RoutingFrame struct {
			Capability             string   `json:"capability"`
			TaskKind               string   `json:"task_kind"`
			LaunchState            string   `json:"launch_state"`
			NextAction             string   `json:"suggested_next_action"`
			ScopeClass             string   `json:"scope_class"`
			PolicyReason           string   `json:"policy_reason"`
			ScopeReason            string   `json:"scope_reason"`
			ClassifierVersion      string   `json:"classifier_version"`
			SchemaVersion          string   `json:"schema_version"`
			ContextResolutionState string   `json:"context_resolution_state"`
			ContextReferenceType   string   `json:"context_reference_type"`
			MissingSlots           []string `json:"missing_slots"`
		} `json:"routing_frame"`
		Handoff struct {
			Capability   string   `json:"capability"`
			AllowedTools []string `json:"allowed_tools"`
		} `json:"handoff"`
		RuntimeDecisionSummary struct {
			PlanningOutcome    string `json:"planning_outcome"`
			SelectedCapability string `json:"selected_capability"`
			TerminalOutcome    string `json:"terminal_outcome"`
		} `json:"runtime_decision_summary"`
		TerminalEnvelope struct {
			Status string `json:"status"`
		} `json:"terminal_envelope"`
	} `json:"runtime_decisions"`
}

func ObserveIntentForEval(
	body json.RawMessage,
	headers map[string]string,
	cfg config.Config,
) (IntentEvalObservation, error) {
	request, httpErr := ParseAnswerRequest(body, headers, cfg)
	if httpErr != nil {
		return IntentEvalObservation{
			SelectedCapability: "none",
			ErrorCode:          canonicalIntentEvalErrorCode(httpErr.Code),
		}, nil
	}

	var bridgePayload intentEvalBridgePayload
	if err := json.Unmarshal(request.Payload, &bridgePayload); err != nil {
		return IntentEvalObservation{}, err
	}
	frame := bridgePayload.RuntimeDecisions.RoutingFrame
	handoff := bridgePayload.RuntimeDecisions.Handoff
	summary := bridgePayload.RuntimeDecisions.RuntimeDecisionSummary
	selectedCapability := "none"
	if handoff.Capability != "" {
		selectedCapability = handoff.Capability
	} else if summary.SelectedCapability != "" {
		selectedCapability = summary.SelectedCapability
	}
	terminalStatus := bridgePayload.RuntimeDecisions.TerminalEnvelope.Status
	if terminalStatus == "" {
		terminalStatus = summary.TerminalOutcome
	}
	return IntentEvalObservation{
		Capability:             frame.Capability,
		TaskKind:               frame.TaskKind,
		LaunchState:            frame.LaunchState,
		NextAction:             frame.NextAction,
		ScopeClass:             frame.ScopeClass,
		PolicyReason:           frame.PolicyReason,
		ScopeReason:            frame.ScopeReason,
		SelectedCapability:     selectedCapability,
		AllowedTools:           append([]string(nil), handoff.AllowedTools...),
		ClassifierVersion:      frame.ClassifierVersion,
		SchemaVersion:          frame.SchemaVersion,
		ContextResolutionState: frame.ContextResolutionState,
		ContextReferenceType:   frame.ContextReferenceType,
		MissingSlots:           append([]string(nil), frame.MissingSlots...),
		PlanningOutcome:        summary.PlanningOutcome,
		TerminalStatus:         terminalStatus,
	}, nil
}

func canonicalIntentEvalErrorCode(code string) string {
	if code == "invalid_request" {
		return "invalid_supervisor_request"
	}
	return code
}
