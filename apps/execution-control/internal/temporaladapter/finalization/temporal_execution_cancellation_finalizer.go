package finalization

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/temporal"
)

// FinalizeExecutionCancellationActivity is the sole owner of the product
// cancellation closeout. The HTTP cancel endpoint only records intent; this
// activity runs after Temporal has observed cancellation and uses an
// idempotent callback/projection order.
func (s *Adapter) FinalizeExecutionCancellation(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	if strings.TrimSpace(input.RequestID) == "" || input.CanceledAt.IsZero() {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
			"execution cancellation finalizer identity is invalid",
			"execution_cancellation_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.RunProjectionStore == nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	if err := s.EnsureTemporalActivityOwnsRootExecution(ctx, input.RequestID, true); err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(input.RequestID))
	if err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	canceledAt := input.CanceledAt.UTC()
	if run.Status != execution.DurableRunStatusCanceled {
		if activityprojection.TemporalRunTerminal(run.Status) {
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, temporal.NewNonRetryableApplicationError(
				"execution run reached a conflicting terminal state",
				"execution_cancellation_terminal_conflict",
				nil,
			)
		}
		writeProductFinalization := s.ProductFinalizationWriter
		if writeProductFinalization == nil {
			writeProductFinalization = s.WriteChatProductFinalization
		}
		if err := writeProductFinalization(
			ctx,
			run,
			canceledAt,
			ProductTerminalErrorResponse(
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
		if err := execution.CancelIncompleteRunWork(ctx, s.RunProjectionStore, run, input.Reason, canceledAt); err != nil {
			return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
		}
		canceled, err := s.RunProjectionStore.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
			RequestID: run.RequestID,
			Reason:    execution.FirstNonEmptyText(strings.TrimSpace(input.Reason), "user_requested"),
			Now:       canceledAt,
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
		RequestID: run.RequestID,
		Status:    string(run.Status),
	}, nil
}

func CancellationFinalizerTime(input temporalruntime.FinalizeExecutionCancellationActivityInput) time.Time {
	return input.CanceledAt.UTC()
}
