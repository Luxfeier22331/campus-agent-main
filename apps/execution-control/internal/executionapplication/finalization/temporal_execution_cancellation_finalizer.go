package finalization

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionfailure"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

// FinalizeExecutionCancellationActivity is the sole owner of the product
// cancellation closeout. The HTTP cancel endpoint only records intent; this
// activity runs after Temporal has observed cancellation and uses an
// idempotent callback/projection order.
func (s *FinalizationService) FinalizeCancellation(
	ctx context.Context,
	input executioncontract.CancellationInput,
) (executioncontract.CancellationOutput, error) {
	if strings.TrimSpace(input.RequestID) == "" || input.CanceledAt.IsZero() {
		return executioncontract.CancellationOutput{}, executionfailure.PermanentError(
			"execution cancellation finalizer identity is invalid",
			"execution_cancellation_finalizer_invalid",
			nil,
		)
	}
	if s == nil || s.RunProjectionStore == nil {
		return executioncontract.CancellationOutput{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.RunProjectionStore.GetRun(ctx, strings.TrimSpace(input.RequestID))
	if err != nil {
		return executioncontract.CancellationOutput{}, err
	}
	canceledAt := input.CanceledAt.UTC()
	if run.Status != execution.DurableRunStatusCanceled {
		if activityprojection.RunTerminal(run.Status) {
			return executioncontract.CancellationOutput{}, executionfailure.PermanentError(
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
			return executioncontract.CancellationOutput{}, err
		}
		// Project incomplete work before committing the terminal run state. A
		// retry can safely repeat these upserts; doing them afterwards would leave
		// a terminal run that completion fencing no longer permits us to repair.
		if err := execution.CancelIncompleteRunWork(ctx, s.RunProjectionStore, run, input.Reason, canceledAt); err != nil {
			return executioncontract.CancellationOutput{}, err
		}
		canceled, err := s.StateWriter.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
			RequestID: run.RequestID,
			Reason:    execution.FirstNonEmptyText(strings.TrimSpace(input.Reason), "user_requested"),
			Now:       canceledAt,
		})
		if err != nil {
			if errors.Is(err, execution.ErrDurableRunTerminalConflict) {
				return executioncontract.CancellationOutput{}, executionfailure.PermanentError(
					"execution cancellation terminal conflict",
					"execution_cancellation_terminal_conflict",
					nil,
				)
			}
			return executioncontract.CancellationOutput{}, err
		}
		run = canceled
	}
	return executioncontract.CancellationOutput{
		RequestID: run.RequestID,
		Status:    string(run.Status),
	}, nil
}

func (s *FinalizationService) FinalizeExecutionCancellation(ctx context.Context, in execution.ExecutionCancellationFinalizationInput) (execution.ExecutionCancellationFinalizationOutput, error) {
	out, err := s.FinalizeCancellation(ctx, executioncontract.CancellationInput{CanceledAt: in.CanceledAt, Reason: in.Reason, RequestID: in.RequestID})
	return execution.ExecutionCancellationFinalizationOutput{RequestID: out.RequestID, Status: out.Status}, err
}
