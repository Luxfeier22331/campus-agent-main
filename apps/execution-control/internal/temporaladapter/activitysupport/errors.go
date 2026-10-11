package activitysupport

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
	"go.temporal.io/sdk/temporal"
)

func TemporalApplicationError(summary executionfailure.Summary, nonRetryable bool) error {
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
	return TemporalApplicationError(executionfailure.Summarize(kind), nonRetryable)
}

// SanitizedTemporalApplicationErrorWithDetails preserves bounded operational
// facts for uncertain attempts without exposing provider payloads or secrets.
func SanitizedTemporalApplicationErrorWithDetails(
	kind string,
	details map[string]string,
	nonRetryable bool,
) error {
	summary := executionfailure.Summarize(kind)
	if nonRetryable {
		return temporal.NewNonRetryableApplicationError(summary.Message, summary.Kind, nil, details)
	}
	return temporal.NewApplicationErrorWithCause(summary.Message, summary.Kind, nil, details)
}
