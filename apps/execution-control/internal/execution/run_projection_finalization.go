package execution

import (
	"fmt"
	"strings"
	"time"
)

const (
	finalizationStepID                 = "finalization.write"
	finalizationStepKind               = "finalization"
	finalizationResultKind             = "final_answer_projection"
	finalizationFingerprintPayloadKey  = "finalization_fingerprint_sha256"
	finalizationCompletionWonErrorCode = "completion_won"
)

func canonicalizeRunProjectionFinalizeRequest(
	request RunProjectionFinalizeRequest,
) (RunProjectionFinalizeRequest, error) {
	request.Completion.RequestID = strings.TrimSpace(request.Completion.RequestID)
	request.Completion.TerminalReason = DurableTerminalReason(
		strings.TrimSpace(string(request.Completion.TerminalReason)),
	)
	request.Completion.FinalResponseRef = strings.TrimSpace(request.Completion.FinalResponseRef)
	request.Completion.Now = canonicalProjectionTime(request.Completion.Now)

	request.Step.RequestID = strings.TrimSpace(request.Step.RequestID)
	request.Step.StepID = strings.TrimSpace(request.Step.StepID)
	request.Step.ConversationID = strings.TrimSpace(request.Step.ConversationID)
	request.Step.StepKind = strings.TrimSpace(request.Step.StepKind)
	request.Step.Status = strings.TrimSpace(request.Step.Status)
	request.Step.StartedAt = canonicalProjectionTime(request.Step.StartedAt)
	request.Step.CompletedAt = canonicalProjectionTime(request.Step.CompletedAt)
	request.Step.UpdatedAt = canonicalProjectionTime(request.Step.UpdatedAt)
	request.Step = cloneRunStepProjection(request.Step)

	request.Attempt.RequestID = strings.TrimSpace(request.Attempt.RequestID)
	request.Attempt.StepID = strings.TrimSpace(request.Attempt.StepID)
	request.Attempt.AttemptID = strings.TrimSpace(request.Attempt.AttemptID)
	request.Attempt.Status = strings.TrimSpace(request.Attempt.Status)
	request.Attempt.ScheduledAt = canonicalProjectionTime(request.Attempt.ScheduledAt)
	request.Attempt.StartedAt = canonicalProjectionTime(request.Attempt.StartedAt)
	request.Attempt.CompletedAt = canonicalProjectionTime(request.Attempt.CompletedAt)
	request.Attempt.UpdatedAt = canonicalProjectionTime(request.Attempt.UpdatedAt)
	request.Attempt = cloneStepAttemptProjection(request.Attempt)

	request.Result.RequestID = strings.TrimSpace(request.Result.RequestID)
	request.Result.StepID = strings.TrimSpace(request.Result.StepID)
	request.Result.ResultID = strings.TrimSpace(request.Result.ResultID)
	request.Result.AttemptID = strings.TrimSpace(request.Result.AttemptID)
	request.Result.Status = strings.TrimSpace(request.Result.Status)
	request.Result.ResultKind = strings.TrimSpace(request.Result.ResultKind)
	request.Result.ProjectionRef = strings.TrimSpace(request.Result.ProjectionRef)
	request.Result.CreatedAt = canonicalProjectionTime(request.Result.CreatedAt)
	var err error
	request.Result, err = canonicalStepResultProjection(request.Result)
	if err != nil {
		return RunProjectionFinalizeRequest{}, runFinalizationConflict("invalid result: %v", err)
	}
	request.Result = cloneStepResultProjection(request.Result)
	request.FinalizationFingerprintSHA256 = strings.TrimSpace(
		request.FinalizationFingerprintSHA256,
	)

	if err := validateRunProjectionFinalizeRequest(request); err != nil {
		return RunProjectionFinalizeRequest{}, err
	}
	return request, nil
}

func validateRunProjectionFinalizeRequest(request RunProjectionFinalizeRequest) error {
	if err := validateDurableRunCompleteRequest(request.Completion); err != nil {
		return runFinalizationConflict("invalid completion: %v", err)
	}
	if err := validateRunStepProjection(request.Step); err != nil {
		return runFinalizationConflict("invalid step: %v", err)
	}
	if err := validateStepAttemptProjection(request.Attempt); err != nil {
		return runFinalizationConflict("invalid attempt: %v", err)
	}
	if err := validateStepResultProjection(request.Result); err != nil {
		return runFinalizationConflict("invalid result: %v", err)
	}
	if _, err := jsonMapToBytes(request.Step.SanitizedPayload); err != nil {
		return runFinalizationConflict("step sanitized_payload is not valid JSON: %v", err)
	}
	if _, err := jsonMapToBytes(request.Attempt.SanitizedPayload); err != nil {
		return runFinalizationConflict("attempt sanitized_payload is not valid JSON: %v", err)
	}

	if request.Step.RequestID != request.Completion.RequestID ||
		request.Attempt.RequestID != request.Completion.RequestID ||
		request.Result.RequestID != request.Completion.RequestID {
		return runFinalizationConflict("completion, step, attempt, and result request_id must match")
	}
	if request.Step.StepID != finalizationStepID ||
		request.Attempt.StepID != finalizationStepID ||
		request.Result.StepID != finalizationStepID {
		return runFinalizationConflict("step_id must be %s", finalizationStepID)
	}
	if request.Step.StepKind != finalizationStepKind {
		return runFinalizationConflict("step_kind must be %s", finalizationStepKind)
	}
	if request.Step.Status != "completed" || request.Attempt.Status != "completed" ||
		request.Result.Status != "completed" {
		return runFinalizationConflict("step, attempt, and result must be completed")
	}
	if request.Step.CompletedAt.IsZero() || request.Attempt.CompletedAt.IsZero() {
		return runFinalizationConflict("completed step and attempt timestamps are required")
	}
	if request.Result.AttemptID != request.Attempt.AttemptID {
		return runFinalizationConflict("result attempt_id must bind to the attempt")
	}
	attemptActivityAttempt := request.Attempt.ActivityAttempt
	if attemptActivityAttempt == 0 {
		attemptActivityAttempt = request.Attempt.Attempt
	}
	if request.Step.ActivityAttempt > 0 &&
		request.Step.ActivityAttempt != attemptActivityAttempt {
		return runFinalizationConflict("step activity_attempt must bind to the attempt")
	}
	if request.Result.ResultKind != finalizationResultKind {
		return runFinalizationConflict("result_kind must be %s", finalizationResultKind)
	}
	if request.Result.ProjectionRef != request.Completion.FinalResponseRef {
		return runFinalizationConflict("result projection_ref must match final_response_ref")
	}
	if !validLowerHexSHA256(request.FinalizationFingerprintSHA256) {
		return runFinalizationConflict("finalization fingerprint must be a lowercase SHA-256")
	}
	storedFingerprint, ok := request.Result.SanitizedPayload[finalizationFingerprintPayloadKey].(string)
	if !ok || storedFingerprint != request.FinalizationFingerprintSHA256 {
		return runFinalizationConflict("result finalization fingerprint differs from the request")
	}
	return nil
}

func validateCanonicalFinalizationRecords(
	run DurableRun,
	completion DurableRunCompleteRequest,
	step RunStepProjection,
	attempt StepAttemptProjection,
	result StepResultProjection,
	fingerprint string,
) error {
	_, err := canonicalizeRunProjectionFinalizeRequest(RunProjectionFinalizeRequest{
		Completion:                    completion,
		Step:                          step,
		Attempt:                       attempt,
		Result:                        result,
		FinalizationFingerprintSHA256: fingerprint,
	})
	if err != nil {
		return err
	}
	if step.ConversationID != run.ConversationID {
		return runFinalizationConflict("canonical step conversation_id differs from the run")
	}
	return nil
}

func completeDurableRunForFinalization(
	run DurableRun,
	completion DurableRunCompleteRequest,
) (DurableRun, error) {
	if !durableRunTransitionAllowed(run.Status, DurableRunStatusCompleted) {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusCompleted,
		)
	}
	run.Status = DurableRunStatusCompleted
	run.TerminalReason = completion.TerminalReason
	run.FinalResponseRef = completion.FinalResponseRef
	run.UpdatedAt = completion.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusCompleted, completion.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func durableRunFinalizationReplayMatches(
	run DurableRun,
	completion DurableRunCompleteRequest,
) bool {
	return run.Status == DurableRunStatusCompleted &&
		canonicalProjectionTime(run.CompletedAt).Equal(completion.Now) &&
		run.TerminalReason == completion.TerminalReason &&
		run.FinalResponseRef == completion.FinalResponseRef
}

func completionWonCancellationCommand(
	command RunCancellationCommand,
	now time.Time,
) (RunCancellationCommand, error) {
	switch command.State {
	case LifecycleIntentStatePending,
		LifecycleIntentStateLeased,
		LifecycleIntentStateConfirmed,
		LifecycleIntentStatePermanentFailed:
	default:
		return RunCancellationCommand{}, runFinalizationConflict(
			"cancellation command has incompatible state %s",
			command.State,
		)
	}
	command.State = LifecycleIntentStateConfirmed
	command.NextAttemptAt = now
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.LastErrorCode = finalizationCompletionWonErrorCode
	command.UpdatedAt = now
	return command, nil
}

func canonicalProjectionTime(value time.Time) time.Time {
	if value.IsZero() {
		return time.Time{}
	}
	return value.UTC().Truncate(time.Microsecond)
}

func runFinalizationConflict(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrRunFinalizationConflict, fmt.Sprintf(format, args...))
}
