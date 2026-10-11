package execution

import (
	"context"
	"strings"
	"time"
)

type cancellationStore interface {
	ListRunSteps(context.Context, string) ([]RunStepProjection, error)
	UpsertRunStep(context.Context, RunStepProjection) (RunStepProjection, error)
	ListStepAttempts(context.Context, string) ([]StepAttemptProjection, error)
	UpsertStepAttempt(context.Context, StepAttemptProjection) (StepAttemptProjection, error)
}

// CancelIncompleteRunWork closes projection records that are still active
// when cancellation wins the run terminal-state race. The operation is
// idempotent: terminal records are left untouched and non-terminal records
// are written with the same cancellation timestamp.
func CancelIncompleteRunWork(
	ctx context.Context,
	store cancellationStore,
	run DurableRun,
	reason string,
	canceledAt time.Time,
) error {
	if store == nil {
		return ErrRunProjectionStoreNotConfigured
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "user_requested"
	}
	canceledAt = canceledAt.UTC().Truncate(time.Microsecond)
	steps, err := store.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return err
	}
	for _, step := range steps {
		if StepProjectionStatusTerminal(step.Status) {
			continue
		}
		step.Status = "canceled"
		step.CompletedAt = canceledAt
		step.UpdatedAt = canceledAt
		if step.SanitizedPayload == nil {
			step.SanitizedPayload = map[string]any{}
		}
		step.SanitizedPayload["cancel_outcome"] = string(CancelOutcomeActivityContextCanceled)
		if step.StartedAt.IsZero() {
			step.SanitizedPayload["cancel_outcome"] = string(CancelOutcomeRequestedBeforeStart)
		}
		step.SanitizedPayload["terminal_reason"] = string(DurableTerminalReasonUserCanceled)
		step.SanitizedPayload["cancel_reason"] = reason
		if _, err := store.UpsertRunStep(ctx, step); err != nil {
			return err
		}
	}
	attempts, err := store.ListStepAttempts(ctx, run.RequestID)
	if err != nil {
		return err
	}
	for _, attempt := range attempts {
		if StepProjectionStatusTerminal(attempt.Status) {
			continue
		}
		attempt.Status = "canceled"
		attempt.CompletedAt = canceledAt
		attempt.UpdatedAt = canceledAt
		attempt.TerminalReason = string(DurableTerminalReasonUserCanceled)
		if attempt.StartedAt.IsZero() {
			attempt.CancelOutcome = CancelOutcomeRequestedBeforeStart
		} else {
			attempt.CancelOutcome = CancelOutcomeActivityContextCanceled
		}
		if attempt.TimeoutOutcome == "" {
			attempt.TimeoutOutcome = TimeoutOutcomeNotTimedOut
		}
		if attempt.LateCompletionOutcome == "" {
			attempt.LateCompletionOutcome = LateCompletionOutcomeNotLate
		}
		if attempt.SanitizedPayload == nil {
			attempt.SanitizedPayload = map[string]any{}
		}
		attempt.SanitizedPayload["cancel_outcome"] = string(attempt.CancelOutcome)
		attempt.SanitizedPayload["terminal_reason"] = attempt.TerminalReason
		attempt.SanitizedPayload["cancel_reason"] = reason
		if _, err := store.UpsertStepAttempt(ctx, attempt); err != nil {
			return err
		}
	}
	return nil
}
