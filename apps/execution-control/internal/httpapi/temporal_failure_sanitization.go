package httpapi

import (
	"errors"
	"strings"

	"go.temporal.io/sdk/temporal"
)

const defaultExecutionFailureMessage = "Execution failed before completion."

type temporalFailureSummary struct {
	Kind    string
	Message string
}

func summarizeTemporalFailure(kind string) temporalFailureSummary {
	kind = boundedTemporalFailureKind(kind)
	return temporalFailureSummary{
		Kind:    kind,
		Message: temporalFailurePublicMessage(kind),
	}
}

func boundedTemporalFailureKind(kind string) string {
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

func temporalFailurePublicMessage(kind string) string {
	switch boundedTemporalFailureKind(kind) {
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
		return defaultExecutionFailureMessage
	}
}

func temporalFailurePayload(projection temporalStepFailureProjection) map[string]any {
	summary := summarizeTemporalFailure(projection.FailureKind)
	payload := cloneAnyMapFromMetadata(projection.Payload)
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

func temporalApplicationError(summary temporalFailureSummary, nonRetryable bool) error {
	if nonRetryable {
		return temporal.NewNonRetryableApplicationError(
			summary.Message,
			summary.Kind,
			nil,
		)
	}
	return temporal.NewApplicationError(summary.Message, summary.Kind)
}

func sanitizedTemporalApplicationError(
	kind string,
	cause error,
	nonRetryable bool,
) error {
	return temporalApplicationError(summarizeTemporalFailure(kind), nonRetryable)
}

func fixedTemporalFailureError(kind string) error {
	return errors.New(temporalFailurePublicMessage(kind))
}
