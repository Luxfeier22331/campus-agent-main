package finalization

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
)

func (s *FinalizationService) WriteChatProductFinalization(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
	finalizedResponse map[string]any,
) error {
	if s == nil || s.FinalizationClient == nil {
		return executionfailure.SanitizedError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return executionfailure.MapProductCallbackError(s.FinalizationClient.WriteExecutionFinalization(
		ctx,
		executionapplication.ExecutionFinalizationRequest{
			RequestID:   run.RequestID,
			CompletedAt: completedAt,
			Response:    finalizedResponse,
		},
	))
}

func ProductTerminalErrorResponse(
	run execution.DurableRun,
	status string,
	code string,
	message string,
	retryable bool,
) map[string]any {
	return ExecutionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		AnswerText:    "",
		Error:         map[string]any{"code": code, "message": message, "retryable": retryable},
		ModelUsage:    ModelUsageWire{},
		Observability: nil,
		Result:        nil,
		Status:        status,
	})
}
