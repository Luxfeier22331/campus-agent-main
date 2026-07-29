package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// executionPayloadMap is an in-memory shape for domain helpers that consume
// the typed v4 input. It must never be attached to a run
// projection, Temporal input, event, step, log, or trace.
func executionPayloadMap(wire contracts.ExecutionPayloadWire) map[string]any {
	result := map[string]any{
		"context":                    cloneAnyMapFromMetadata(wire.Context),
		"conversation_id":            wire.ConversationID,
		"execution_contract_version": wire.ExecutionContractVersion,
		"request_id":                 wire.RequestID,
		"response_contract":          wire.ResponseContract,
		"tenant_id":                  wire.TenantID,
		"trace": map[string]any{
			"trace_id": wire.Trace.TraceID,
		},
		"user_goal": wire.UserGoal,
	}
	if wire.SafetyIdentifier != nil {
		result["safety_identifier"] = *wire.SafetyIdentifier
	}
	return result
}

func (s *Server) loadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	wire, err := s.loadExecutionInput(ctx, run)
	if err != nil {
		return nil, err
	}
	return executionPayloadMap(wire), nil
}

func executionInputFailureKind(err error, fallback string) string {
	if kind := executionInputErrorKind(err); kind != "" && kind != "execution_input_unavailable" {
		return kind
	}
	return fallback
}

func executionInputFailureIsNonRetryable(err error) bool {
	return !executionInputErrorIsRetryable(err)
}
