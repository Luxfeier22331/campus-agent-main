package projection

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

func FailurePayload(projection StepFailureProjection) map[string]any {
	summary := executionfailure.Summarize(projection.FailureKind)
	payload := execution.CloneAnyMapFromValue(projection.Payload)
	delete(payload, "failure_hash")
	delete(payload, "failure_kind")
	delete(payload, "fail_close_reason")
	delete(payload, "message")
	if _, ok := payload["failure"]; !ok {
		payload["failure"] = map[string]any{
			"code":      summary.Kind,
			"operation": strings.TrimSpace(projection.StepID),
		}
	}
	payload["message"] = summary.Message
	return payload
}
