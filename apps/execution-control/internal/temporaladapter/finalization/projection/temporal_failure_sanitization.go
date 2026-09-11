package projection

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"go.temporal.io/sdk/temporal"
)

const DefaultExecutionFailureMessage = "Execution failed before completion."

type TemporalFailureSummary struct {
	Kind    string
	Message string
}

func SummarizeTemporalFailure(kind string) TemporalFailureSummary {
	kind = BoundedTemporalFailureKind(kind)
	return TemporalFailureSummary{
		Kind:    kind,
		Message: TemporalFailurePublicMessage(kind),
	}
}

func BoundedTemporalFailureKind(kind string) string {
	kind = strings.TrimSpace(kind)
	if kind == "" || len(kind) > 64 {
		return "execution_failed"
	}
	for _, char := range kind {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return "execution_failed"
	}
	return kind
}

func TemporalFailurePublicMessage(kind string) string {
	switch BoundedTemporalFailureKind(kind) {
	case "personal_memory_not_configured":
		return "Personal memory could not be loaded for this request."
	case "agent_runtime_timeout", "agent_deadline_exceeded":
		return "The agent runtime did not complete before its deadline."
	case "provider_rate_limited", "provider_http_failed", "provider_connection_failed",
		"provider_timeout", "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "citation_validation_failed":
		return "The answer citations could not be verified."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	default:
		return DefaultExecutionFailureMessage
	}
}

func TemporalFailurePayload(projection TemporalStepFailureProjection) map[string]any {
	summary := SummarizeTemporalFailure(projection.FailureKind)
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

func TemporalApplicationError(summary TemporalFailureSummary, nonRetryable bool) error {
	if nonRetryable {
		return temporal.NewNonRetryableApplicationError(
			summary.Message,
			summary.Kind,
			nil,
		)
	}
	return temporal.NewApplicationError(summary.Message, summary.Kind)
}

func SanitizedTemporalApplicationError(
	kind string,
	cause error,
	nonRetryable bool,
) error {
	return TemporalApplicationError(SummarizeTemporalFailure(kind), nonRetryable)
}

// SanitizedTemporalApplicationErrorWithDetails preserves bounded operational
// facts for uncertain attempts without exposing provider payloads or secrets.
func SanitizedTemporalApplicationErrorWithDetails(
	kind string,
	details map[string]string,
	nonRetryable bool,
) error {
	summary := SummarizeTemporalFailure(kind)
	if nonRetryable {
		return temporal.NewNonRetryableApplicationError(summary.Message, summary.Kind, nil, details)
	}
	return temporal.NewApplicationErrorWithCause(summary.Message, summary.Kind, nil, details)
}
