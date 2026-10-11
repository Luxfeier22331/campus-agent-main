package outboundadapter

import (
	"fmt"
	"strings"

	wire "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

func mapRuntimeResult(r wire.AgentRuntimeResponse) executionapplication.AgentRuntimeResult {
	out := executionapplication.AgentRuntimeResult{
		Operation:               r.Operation,
		SolveOutcome:            r.SolveOutcome,
		Status:                  r.Status,
		Error:                   executionapplication.AgentRuntimeError(r.Error),
		RequestID:               r.RequestID,
		ContextUsage:            r.ContextUsage,
		FinalOutput:             r.FinalOutput,
		Plan:                    r.Plan,
		Replan:                  r.Replan,
		RemainingFacts:          r.RemainingFacts,
		Evidence:                r.Evidence,
		SourceAttempts:          r.SourceAttempts,
		ModelName:               r.ModelName,
		ModelProvider:           r.ModelProvider,
		ProviderResponseID:      r.ProviderResponseID,
		StageTiming:             r.StageTiming,
		TerminalReason:          r.TerminalReason,
		ToolContractFingerprint: r.ToolContractFingerprint,
		RuntimeRelease:          r.RuntimeRelease,
		Usage:                   executionapplication.AgentRuntimeUsage(r.Usage),
		ModelOutputDiagnostic:   r.ModelOutputDiagnostic,
		WebEvidence:             r.WebEvidence,
		WebSearchDiagnostic:     r.WebSearchDiagnostic,
		Failure:                 r.Failure,
		AnswerStarted:           r.AnswerStarted,
	}
	if r.ToolResults != nil {
		out.ToolResults = make([]executionapplication.AgentToolResult, len(r.ToolResults))
		for i, t := range r.ToolResults {
			out.ToolResults[i] = executionapplication.AgentToolResult(t)
		}
	}
	return out
}
func mapRuntimeFailure(e wire.AgentRuntimeError, release string, status int) executionapplication.AgentRuntimeFailure {
	kind := "agent_runtime_request_failed"
	switch strings.TrimSpace(e.Code) {
	case "workflow_operation_payload_too_large", "invalid_request", "context_budget_exceeded", "agent_deadline_exceeded", "max_turns_exceeded", "retrieval_budget_exhausted", "provider_rate_limited", "provider_http_failed", "provider_connection_failed", "provider_timeout", "provider_unavailable", "tool_execution_failed", "tool_contract_mismatch", "citation_validation_failed", "run_failed":
		kind = strings.TrimSpace(e.Code)
	case "answer_synthesis_failed", "materials_insufficient":
		if status != 0 {
			kind = strings.TrimSpace(e.Code)
		}
	}
	if status == 401 {
		kind = "agent_runtime_unauthorized"
	}
	evidenceStatus := e.HTTPStatus
	if evidenceStatus == 0 {
		evidenceStatus = status
	}
	return executionapplication.AgentRuntimeFailure{
		SafeMessage:    runtimeFailureMessage(e.Code, status),
		Kind:           kind,
		Code:           strings.TrimSpace(e.Code),
		Reason:         e.Reason,
		Citation:       e.Citation,
		Operation:      strings.TrimSpace(e.Operation),
		Detail:         strings.TrimSpace(e.Detail),
		HTTPStatus:     evidenceStatus,
		InvocationID:   strings.TrimSpace(e.InvocationID),
		RuntimeRelease: strings.TrimSpace(release),
	}
}
func mapRuntimeEvent(e wire.Event) (executionapplication.AgentRuntimeEvent, error) {
	out := executionapplication.AgentRuntimeEvent{Event: e.Event}
	switch e.Event {
	case "retrieval_status":
		if e.Retrieval.SchemaVersion != "workflow_runtime_retrieval_status.v1" || e.Retrieval.OccurredAt.IsZero() || !execution.ValidRetrievalStatus(e.Retrieval.Source, e.Retrieval.Status) {
			return out, fmt.Errorf("invalid retrieval status event")
		}
		out.Retrieval = executionapplication.RuntimeRetrievalStatus{Source: e.Retrieval.Source, Status: e.Retrieval.Status, OccurredAt: e.Retrieval.OccurredAt}
	case "solve_decision":
		if e.Decision.SchemaVersion != "workflow_runtime_solve_decision.v1" || (e.Decision.Outcome != "answer" && e.Decision.Outcome != "plan") {
			return out, fmt.Errorf("workflow runtime solve decision schema or value is invalid")
		}
		out.Decision = executionapplication.SolveDecision{Outcome: e.Decision.Outcome}
	case "answer_delta":
		if (e.Delta.SchemaVersion != "workflow_runtime_answer_delta.v1" && e.Delta.SchemaVersion != "workflow_runtime_answer_delta.v2") || e.Delta.Delta == "" {
			return out, fmt.Errorf("workflow runtime answer delta schema or value is invalid")
		}
		if e.Delta.SchemaVersion == "workflow_runtime_answer_delta.v2" && (e.Delta.Provisional == nil || !*e.Delta.Provisional) {
			return out, fmt.Errorf("workflow runtime answer delta must be provisional")
		}
		out.Delta = executionapplication.AnswerDelta{Delta: e.Delta.Delta, Provisional: e.Delta.Provisional}
	case "answer_invalidated":
		if e.Invalidation.SchemaVersion != "workflow_runtime_answer_invalidation.v1" || e.Invalidation.Reason != "terminal_result_unavailable" {
			return out, fmt.Errorf("workflow runtime answer invalidation schema or order is invalid")
		}
		out.Invalidation = executionapplication.AnswerInvalidation{Reason: e.Invalidation.Reason}
	case "completed", "failed":
		out.Result = mapRuntimeResult(e.Result)
	case "error":
		out.Failure = mapRuntimeFailure(e.Failure.AgentRuntimeError, e.Failure.RuntimeRelease, 0)
	}
	return out, nil
}

// Only adapter-owned text may enter the public error message; provider text is
// retained separately as bounded diagnostic evidence.
func runtimeFailureMessage(code string, status int) string {
	switch strings.TrimSpace(code) {
	case "provider_rate_limited", "provider_http_failed", "provider_connection_failed", "provider_timeout", "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "agent_deadline_exceeded", "context_budget_exceeded", "max_turns_exceeded", "run_failed":
		return "The agent runtime could not complete the request."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	case "tool_contract_mismatch":
		return "The admitted tool contract does not match the agent runtime."
	}
	if status >= 500 {
		return fmt.Sprintf("agent runtime returned HTTP %d", status)
	}
	return "The agent runtime request was rejected."
}
