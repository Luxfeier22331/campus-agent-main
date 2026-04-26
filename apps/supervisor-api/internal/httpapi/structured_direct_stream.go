package httpapi

import (
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func emitStructuredRuntimeStreamFailure(
	response http.ResponseWriter,
	executionRequest execution.AnswerExecutionRequest,
	status int,
	code string,
	message string,
	retryable bool,
) {
	emitSSE(response, "execution.failed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.failed",
		Status:     "failed",
		Outcome:    code,
		HTTPStatus: status,
		Retryable:  retryable,
		Error: &errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
}
