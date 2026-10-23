package execution

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/contracts"
)

// PayloadMap is the in-memory shape consumed by execution helpers. It must
// never be attached to a run projection, Temporal input, event, step, log, or trace.
func PayloadMap(wire contracts.ExecutionPayloadWire) map[string]any {
	result := map[string]any{
		"context":                    cloneInputMap(wire.Context),
		"conversation_id":            wire.ConversationID,
		"execution_contract_version": wire.ExecutionContractVersion,
		"request_id":                 wire.RequestID,
		"response_contract":          wire.ResponseContract,
		"tenant_id":                  wire.TenantID,
		"user_goal":                  wire.UserGoal,
	}
	if wire.SafetyIdentifier != nil {
		result["safety_identifier"] = *wire.SafetyIdentifier
	}
	return result
}

func InputFailureKind(err error, fallback string) string {
	if kind := InputErrorKind(err); kind != "" && kind != "execution_input_unavailable" {
		return kind
	}
	return fallback
}

func cloneInputMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = value
	}
	return cloned
}
