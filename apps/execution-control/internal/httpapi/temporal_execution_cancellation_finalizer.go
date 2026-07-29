package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

// FinalizeExecutionCancellationActivity is the sole owner of the product
// cancellation closeout. The HTTP cancel endpoint only records intent; this
// activity runs after Temporal has observed cancellation and uses an
// idempotent callback/projection order.
func (s *Server) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	if strings.TrimSpace(input.RunID) == "" || strings.TrimSpace(input.TraceID) == "" || input.CanceledAt.IsZero() {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution cancellation finalizer identity is invalid",
			"execution_cancellation_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.runProjectionStore == nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.ensureTemporalActivityOwnsRootExecution(ctx, input.RunID, true); err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	run, err := s.runProjectionStore.GetRun(ctx, strings.TrimSpace(input.RunID))
	if err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	if run.TraceID != strings.TrimSpace(input.TraceID) {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution cancellation finalizer identity mismatch",
			"execution_cancellation_finalizer_invalid",
			nil,
		)
	}
	canceledAt := input.CanceledAt.UTC()
	if run.Status != execution.DurableRunStatusCanceled {
		if temporalRunTerminal(run.Status) {
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
				"execution run reached a conflicting terminal state",
				"execution_cancellation_terminal_conflict",
				nil,
			)
		}
		writeProductFinalization := s.productFinalizationWriter
		if writeProductFinalization == nil {
			writeProductFinalization = s.writeChatProductFinalization
		}
		if err := writeProductFinalization(
			ctx,
			run,
			canceledAt,
			productTerminalErrorResponse(
				run,
				"cancelled",
				"execution_cancelled",
				"Execution was cancelled before completion.",
				false,
			),
		); err != nil {
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
		}
		// Project incomplete work before committing the terminal run state. A
		// retry can safely repeat these upserts; doing them afterwards would leave
		// a terminal run that completion fencing no longer permits us to repair.
		if err := s.projectCanceledRunSteps(ctx, run, input.Reason, canceledAt); err != nil {
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
		}
		canceled, err := s.runProjectionStore.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
			RunID:  run.RunID,
			Reason: firstNonEmptyText(strings.TrimSpace(input.Reason), "user_requested"),
			Now:    canceledAt,
		})
		if err != nil {
			if errors.Is(err, execution.ErrDurableRunTerminalConflict) {
				return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
					"execution cancellation terminal conflict",
					"execution_cancellation_terminal_conflict",
					nil,
				)
			}
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
		}
		run = canceled
	}
	return temporalruntime.FinalizeExecutionCancellationActivityOutput{
		RunID:  run.RunID,
		Status: string(run.Status),
	}, nil
}

func cancellationFinalizerTime(input temporalruntime.FinalizeExecutionCancellationActivityInput) time.Time {
	return input.CanceledAt.UTC()
}
