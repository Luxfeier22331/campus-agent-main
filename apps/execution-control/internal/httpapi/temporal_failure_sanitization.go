package httpapi

import (
	"errors"
	"strings"

	"go.temporal.io/sdk/temporal"
)

const defaultExecutionFailureMessage = "Execution failed before completion."

type temporalFailureSummary struct {
	Hash    string
	Kind    string
	Message string
}

func summarizeTemporalFailure(kind string, failureHash string, cause error) temporalFailureSummary {
	kind = boundedTemporalFailureKind(kind)
	if !validTemporalFailureHash(failureHash) {
		failureHash = memoryFailureHash(cause)
	}
	return temporalFailureSummary{
		Hash:    failureHash,
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

func validTemporalFailureHash(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}

func temporalFailurePublicMessage(kind string) string {
	switch boundedTemporalFailureKind(kind) {
	case "personal_memory_not_configured":
		return "Personal memory could not be loaded for this request."
	case "agent_runtime_timeout", "agent_deadline_exceeded":
		return "The agent runtime did not complete before its deadline."
	case "agent_runtime_failed", "model_setting_missing", "provider_unavailable":
		return "The answer provider is temporarily unavailable."
	case "tool_execution_failed":
		return "A runtime tool could not complete."
	default:
		return defaultExecutionFailureMessage
	}
}

func temporalFailurePayload(projection temporalStepFailureProjection, cause error) map[string]any {
	summary := summarizeTemporalFailure(projection.FailureKind, projection.FailureHash, cause)
	payload := cloneAnyMapFromMetadata(projection.Payload)
	delete(payload, "message")
	payload["failure_hash"] = summary.Hash
	payload["failure_kind"] = summary.Kind
	payload["message"] = summary.Message
	return payload
}

func temporalApplicationError(summary temporalFailureSummary, nonRetryable bool) error {
	if nonRetryable {
		return temporal.NewNonRetryableApplicationError(
			summary.Message,
			summary.Kind,
			nil,
			summary.Hash,
		)
	}
	return temporal.NewApplicationError(summary.Message, summary.Kind, summary.Hash)
}

func sanitizedTemporalApplicationError(
	kind string,
	cause error,
	nonRetryable bool,
) error {
	return temporalApplicationError(summarizeTemporalFailure(kind, "", cause), nonRetryable)
}

func fixedTemporalFailureError(kind string) error {
	return errors.New(temporalFailurePublicMessage(kind))
}
