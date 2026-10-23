package codec

import (
	"time"

	wire "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/agentruntimeprotocol"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

func runtimeRequestPayload(r executionapplication.AgentRuntimeRequest) wire.Request {
	payload := wire.Request{
		"deadline_at":                 r.DeadlineAt.Format(time.RFC3339Nano),
		"activity_attempt":            r.ActivityAttempt,
		"user_id":                     r.UserID,
		"request_id":                  r.RequestID,
		"conversation_id":             r.ConversationID,
		"operation":                   string(r.Operation),
		"operation_input":             r.Input,
		"visible_function_tool_names": append([]string{}, r.VisibleFunctionToolNames...),
		"limits": map[string]any{
			"agent_deadline_ms":        r.Limits.AgentDeadlineMS,
			"context_char_limit":       r.Limits.ContextCharLimit,
			"current_input_char_limit": r.Limits.CurrentInputCharLimit,
			"max_output_tokens":        r.Limits.MaxOutputTokens,
			"max_function_tool_calls":  r.Limits.MaxFunctionToolCalls,
			"max_turns":                r.Limits.MaxTurns,
			"max_plan_steps":           r.Limits.MaxPlanSteps,
			"max_replans":              r.Limits.MaxReplans,
		},
		"expected_model_target_sha256": r.ModelTargetSHA256,
	}
	if r.Operation == executioncontract.WorkflowOperationSolve || r.Operation == executioncontract.WorkflowOperationExecuteStep {
		payload["model_answer_transport"] = "buffered"
		if r.StreamModelAnswer {
			payload["model_answer_transport"] = "stream"
		}
	}
	if r.ToolContractFingerprint != nil {
		payload["expected_tool_contract_fingerprint"] = r.ToolContractFingerprint
	}
	if len(r.PriorEvidence) > 0 {
		payload["prior_evidence"] = r.PriorEvidence
	}
	if len(r.PriorSourceAttempts) > 0 {
		payload["prior_source_attempts"] = r.PriorSourceAttempts
	}
	if len(r.ConversationContext) > 0 {
		payload["conversation_context"] = r.ConversationContext
	}
	return payload
}

// Prepare is local: receipt admission must reject invalid or oversized input
// before Execute can perform any network I/O.

func RuntimeRequestPayload(r executionapplication.AgentRuntimeRequest) map[string]any {
	return runtimeRequestPayload(r)
}
