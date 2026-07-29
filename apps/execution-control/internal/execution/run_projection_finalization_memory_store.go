package execution

import (
	"context"
	"fmt"
	"time"
)

func (s *InMemoryRunProjectionStore) FinalizeRunProjection(
	_ context.Context,
	request RunProjectionFinalizeRequest,
) (RunProjectionFinalizeResult, error) {
	request, err := canonicalizeRunProjectionFinalizeRequest(request)
	if err != nil {
		return RunProjectionFinalizeResult{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	run, exists := s.runs[request.Completion.RunID]
	if !exists {
		return RunProjectionFinalizeResult{}, fmt.Errorf(
			"%w: %s",
			ErrDurableRunNotFound,
			request.Completion.RunID,
		)
	}
	if durableRunStatusIsTerminal(run.Status) && run.Status != DurableRunStatusCompleted {
		return RunProjectionFinalizeResult{}, fmt.Errorf(
			"%w: run status is %s",
			ErrDurableRunTerminalConflict,
			run.Status,
		)
	}

	results := s.finalizationResultsLocked(run.RunID)
	if len(results) > 1 {
		return RunProjectionFinalizeResult{}, runFinalizationConflict(
			"run %s has %d finalization results",
			run.RunID,
			len(results),
		)
	}
	if len(results) == 1 {
		step, attempt, result, err := s.canonicalFinalizationRecordsLocked(run, results[0])
		if err != nil {
			return RunProjectionFinalizeResult{}, err
		}
		if err := validateCanonicalFinalizationRecords(
			run,
			request.Completion,
			step,
			attempt,
			result,
			request.FinalizationFingerprintSHA256,
		); err != nil {
			return RunProjectionFinalizeResult{}, err
		}
		if run.Status == DurableRunStatusCompleted {
			if !durableRunFinalizationReplayMatches(run, request.Completion) {
				return RunProjectionFinalizeResult{}, runFinalizationConflict(
					"completed run identity differs from the request",
				)
			}
			return cloneRunProjectionFinalizeResult(run, step, attempt, result), nil
		}

		completionWonCommand, hasCancellation, err := s.completionWonCancellationLocked(
			run.RunID,
			request.Completion.Now,
		)
		if err != nil {
			return RunProjectionFinalizeResult{}, err
		}
		completedRun, err := completeDurableRunForFinalization(run, request.Completion)
		if err != nil {
			return RunProjectionFinalizeResult{}, err
		}
		s.runs[run.RunID] = cloneDurableRun(completedRun)
		if hasCancellation {
			s.cancellationCommands[run.RunID] = completionWonCommand
		}
		delete(s.activeRunByConversation, run.ConversationID)
		return cloneRunProjectionFinalizeResult(completedRun, step, attempt, result), nil
	}

	if run.Status == DurableRunStatusCompleted {
		return RunProjectionFinalizeResult{}, runFinalizationConflict(
			"completed run is missing its canonical finalization result",
		)
	}
	if request.Step.ConversationID != run.ConversationID {
		return RunProjectionFinalizeResult{}, runFinalizationConflict(
			"candidate step conversation_id differs from the run",
		)
	}
	if err := s.validateCandidateFinalizationWritesLocked(request); err != nil {
		return RunProjectionFinalizeResult{}, err
	}
	completionWonCommand, hasCancellation, err := s.completionWonCancellationLocked(
		run.RunID,
		request.Completion.Now,
	)
	if err != nil {
		return RunProjectionFinalizeResult{}, err
	}
	completedRun, err := completeDurableRunForFinalization(run, request.Completion)
	if err != nil {
		return RunProjectionFinalizeResult{}, err
	}

	s.runSteps[runStepKey(run.RunID, request.Step.StepID)] = cloneRunStepProjection(request.Step)
	s.stepAttempts[stepAttemptKey(run.RunID, request.Attempt.AttemptID)] = cloneStepAttemptProjection(
		request.Attempt,
	)
	s.stepResults[stepResultKey(run.RunID, request.Result.ResultID)] = cloneStepResultProjection(
		request.Result,
	)
	s.runs[run.RunID] = cloneDurableRun(completedRun)
	if hasCancellation {
		s.cancellationCommands[run.RunID] = completionWonCommand
	}
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneRunProjectionFinalizeResult(
		completedRun,
		request.Step,
		request.Attempt,
		request.Result,
	), nil
}

func (s *InMemoryRunProjectionStore) finalizationResultsLocked(runID string) []StepResultProjection {
	results := make([]StepResultProjection, 0, 1)
	for _, result := range s.stepResults {
		if result.RunID == runID && result.StepID == finalizationStepID {
			results = append(results, result)
		}
	}
	return results
}

func (s *InMemoryRunProjectionStore) canonicalFinalizationRecordsLocked(
	run DurableRun,
	result StepResultProjection,
) (RunStepProjection, StepAttemptProjection, StepResultProjection, error) {
	step, exists := s.runSteps[runStepKey(run.RunID, result.StepID)]
	if !exists {
		return RunStepProjection{}, StepAttemptProjection{}, StepResultProjection{},
			runFinalizationConflict("canonical finalization step is missing")
	}
	attempt, exists := s.stepAttempts[stepAttemptKey(run.RunID, result.AttemptID)]
	if !exists {
		return RunStepProjection{}, StepAttemptProjection{}, StepResultProjection{},
			runFinalizationConflict("canonical finalization attempt is missing")
	}
	for _, current := range s.stepAttempts {
		if current.AttemptID == attempt.AttemptID &&
			(current.RunID != attempt.RunID || current.StepID != attempt.StepID) {
			return RunStepProjection{}, StepAttemptProjection{}, StepResultProjection{},
				runFinalizationConflict(
					"canonical attempt_id is also bound to run %s step %s",
					current.RunID,
					current.StepID,
				)
		}
	}
	for _, current := range s.stepResults {
		if current.ResultID == result.ResultID &&
			(current.RunID != result.RunID || current.StepID != result.StepID) {
			return RunStepProjection{}, StepAttemptProjection{}, StepResultProjection{},
				runFinalizationConflict(
					"canonical result_id is also bound to run %s step %s",
					current.RunID,
					current.StepID,
				)
		}
	}
	return step, attempt, result, nil
}

func (s *InMemoryRunProjectionStore) completionWonCancellationLocked(
	runID string,
	now time.Time,
) (RunCancellationCommand, bool, error) {
	command, exists := s.cancellationCommands[runID]
	if !exists {
		return RunCancellationCommand{}, false, nil
	}
	command, err := completionWonCancellationCommand(command, now)
	if err != nil {
		return RunCancellationCommand{}, false, err
	}
	return command, true, nil
}

func (s *InMemoryRunProjectionStore) validateCandidateFinalizationWritesLocked(
	request RunProjectionFinalizeRequest,
) error {
	stepKey := runStepKey(request.Step.RunID, request.Step.StepID)
	if current, exists := s.runSteps[stepKey]; exists &&
		!runStepProjectionUpdateAllowed(current, request.Step) {
		return runFinalizationConflict("candidate finalization step conflicts with the canonical step")
	}

	for _, current := range s.stepAttempts {
		if current.AttemptID == request.Attempt.AttemptID &&
			(current.RunID != request.Attempt.RunID || current.StepID != request.Attempt.StepID) {
			return runFinalizationConflict(
				"candidate attempt_id is already bound to run %s step %s",
				current.RunID,
				current.StepID,
			)
		}
		if current.RunID == request.Attempt.RunID &&
			current.StepID == request.Attempt.StepID &&
			current.Attempt == request.Attempt.Attempt &&
			current.AttemptID != request.Attempt.AttemptID {
			return runFinalizationConflict(
				"candidate attempt number is already bound to attempt_id %s",
				current.AttemptID,
			)
		}
	}
	attemptKey := stepAttemptKey(request.Attempt.RunID, request.Attempt.AttemptID)
	if current, exists := s.stepAttempts[attemptKey]; exists &&
		!stepAttemptProjectionUpdateAllowed(current, request.Attempt) {
		return runFinalizationConflict("candidate finalization attempt conflicts with the canonical attempt")
	}

	for _, current := range s.stepResults {
		if current.ResultID == request.Result.ResultID {
			return runFinalizationConflict(
				"candidate result_id is already bound to run %s step %s",
				current.RunID,
				current.StepID,
			)
		}
	}
	return nil
}

func cloneRunProjectionFinalizeResult(
	run DurableRun,
	step RunStepProjection,
	attempt StepAttemptProjection,
	result StepResultProjection,
) RunProjectionFinalizeResult {
	return RunProjectionFinalizeResult{
		Run:     cloneDurableRun(run),
		Step:    cloneRunStepProjection(step),
		Attempt: cloneStepAttemptProjection(attempt),
		Result:  cloneStepResultProjection(result),
	}
}
