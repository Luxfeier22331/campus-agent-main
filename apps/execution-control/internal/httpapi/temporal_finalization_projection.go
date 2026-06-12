package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func temporalFinalizationResultPayload(
	finalizedResponse map[string]any,
	input temporalruntime.WriteFinalizationActivityInput,
	run execution.DurableRun,
) map[string]any {
	return map[string]any{
		"finalized_response": finalizedResponse,
		"grounding_ref":      input.GroundingRef,
		"request_id":         run.RequestID,
		"synthesis_ref":      input.SynthesisRef,
		"trace_id":           run.TraceID,
	}
}
