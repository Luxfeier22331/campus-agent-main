package execution

import (
	"encoding/json"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type IntentEvalObservation struct {
	Tool                   string   `json:"tool"`
	TaskKind               string   `json:"task_kind"`
	LaunchState            string   `json:"launch_state"`
	NextAction             string   `json:"next_action"`
	ScopeClass             string   `json:"scope_class"`
	PolicyReason           string   `json:"policy_reason"`
	ScopeReason            string   `json:"scope_reason"`
	SelectedTool           string   `json:"selected_tool"`
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

type intentEvalExecutionPayload struct {
	RuntimeDecisions struct {
		RoutingFrame struct {
			Tool                   string   `json:"tool"`
			Target                 string   `json:"target"`
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
			Tool         string   `json:"tool"`
			AllowedTools []string `json:"allowed_tools"`
		} `json:"handoff"`
		RuntimeDecisionSummary struct {
			PlanningOutcome string `json:"planning_outcome"`
			SelectedTool    string `json:"selected_tool"`
			TerminalOutcome string `json:"terminal_outcome"`
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
			SelectedTool: "none",
			ErrorCode:    canonicalIntentEvalErrorCode(httpErr.Code),
		}, nil
	}

	var executionPayload intentEvalExecutionPayload
	if err := json.Unmarshal(request.Payload, &executionPayload); err != nil {
		return IntentEvalObservation{}, err
	}
	frame := executionPayload.RuntimeDecisions.RoutingFrame
	handoff := executionPayload.RuntimeDecisions.Handoff
	summary := executionPayload.RuntimeDecisions.RuntimeDecisionSummary
	selectedTool := "none"
	if handoff.Tool != "" {
		selectedTool = handoff.Tool
	} else if summary.SelectedTool != "" {
		selectedTool = summary.SelectedTool
	}
	terminalStatus := executionPayload.RuntimeDecisions.TerminalEnvelope.Status
	if terminalStatus == "" {
		terminalStatus = summary.TerminalOutcome
	}
	target := frame.Target
	if target == "" {
		target = frame.Tool
	}
	return IntentEvalObservation{
		Tool:                   target,
		TaskKind:               frame.TaskKind,
		LaunchState:            frame.LaunchState,
		NextAction:             frame.NextAction,
		ScopeClass:             frame.ScopeClass,
		PolicyReason:           frame.PolicyReason,
		ScopeReason:            frame.ScopeReason,
		SelectedTool:           selectedTool,
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
		return "invalid_execution_request"
	}
	return code
}
