package finalization

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
)

func (s *Adapter) WriteChatProductFinalization(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
	finalizedResponse map[string]any,
) error {
	if s == nil || s.ProductCallbackClient == nil {
		return activityprojection.SanitizedTemporalApplicationError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return activityprojection.MapProductCallbackError(s.ProductCallbackClient.WriteExecutionFinalization(
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
