package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"time"
)

func (s *InMemoryRunProjectionStore) FinalizeRunProjection(
	_ context.Context,
	request execution.RunProjectionFinalizeRequest,
) (execution.RunProjectionFinalizeResult, error) {
	request, err := execution.CanonicalizeRunProjectionFinalizeRequest(request)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	run, exists := s.runs[request.Completion.RequestID]
	if !exists {
		return execution.RunProjectionFinalizeResult{}, fmt.Errorf(
			"%w: %s",
			execution.ErrDurableRunNotFound,
			request.Completion.RequestID,
		)
	}
	if execution.DurableRunStatusIsTerminal(run.Status) && run.Status != execution.DurableRunStatusCompleted {
		return execution.RunProjectionFinalizeResult{}, fmt.Errorf(
			"%w: run status is %s",
			execution.ErrDurableRunTerminalConflict,
			run.Status,
		)
	}

	results := s.finalizationResultsLocked(run.RequestID)
	if len(results) > 1 {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"run %s has %d finalization results",
			run.RequestID,
			len(results),
		)
	}
	if len(results) == 1 {
		step, attempt, result, err := s.canonicalFinalizationRecordsLocked(run, results[0])
		if err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if err := execution.ValidateCanonicalFinalizationRecords(
			run,
			request.Completion,
			step,
			attempt,
			result,
			request.FinalizationFingerprintSHA256,
		); err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		if run.Status == execution.DurableRunStatusCompleted {
			if !execution.DurableRunFinalizationReplayMatches(run, request.Completion) {
				return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
					"completed run identity differs from the request",
				)
			}
			return cloneRunProjectionFinalizeResult(run, step, attempt, result), nil
		}

		completionWonCommand, hasCancellation, err := s.completionWonCancellationLocked(
			run.RequestID,
			request.Completion.Now,
		)
		if err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		completedRun, err := execution.CompleteDurableRunForFinalization(run, request.Completion)
		if err != nil {
			return execution.RunProjectionFinalizeResult{}, err
		}
		s.runs[run.RequestID] = execution.CloneDurableRun(completedRun)
		if hasCancellation {
			s.cancellationCommands[run.RequestID] = completionWonCommand
		}
		delete(s.activeRunByConversation, run.ConversationID)
		return cloneRunProjectionFinalizeResult(completedRun, step, attempt, result), nil
	}

	if run.Status == execution.DurableRunStatusCompleted {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"completed run is missing its canonical finalization result",
		)
	}
	if request.Step.ConversationID != run.ConversationID {
		return execution.RunProjectionFinalizeResult{}, execution.RunFinalizationConflict(
			"candidate step conversation_id differs from the run",
		)
	}
	if err := s.validateCandidateFinalizationWritesLocked(request); err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	completionWonCommand, hasCancellation, err := s.completionWonCancellationLocked(
		run.RequestID,
		request.Completion.Now,
	)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}
	completedRun, err := execution.CompleteDurableRunForFinalization(run, request.Completion)
	if err != nil {
		return execution.RunProjectionFinalizeResult{}, err
	}

	s.runSteps[execution.RunStepKey(run.RequestID, request.Step.StepID)] = execution.CloneRunStepProjection(request.Step)
	s.stepAttempts[execution.StepAttemptKey(run.RequestID, request.Attempt.AttemptID)] = execution.CloneStepAttemptProjection(
		request.Attempt,
	)
	s.stepResults[execution.StepResultKey(run.RequestID, request.Result.ResultID)] = execution.CloneStepResultProjection(
		request.Result,
	)
	s.runs[run.RequestID] = execution.CloneDurableRun(completedRun)
	if hasCancellation {
		s.cancellationCommands[run.RequestID] = completionWonCommand
	}
	delete(s.activeRunByConversation, run.ConversationID)
	return cloneRunProjectionFinalizeResult(
		completedRun,
		request.Step,
		request.Attempt,
		request.Result,
	), nil
}

func (s *InMemoryRunProjectionStore) finalizationResultsLocked(requestID string) []execution.StepResultProjection {
	results := make([]execution.StepResultProjection, 0, 1)
	for _, result := range s.stepResults {
		if result.RequestID == requestID && result.StepID == execution.FinalizationStepID {
			results = append(results, result)
		}
	}
	return results
}

func (s *InMemoryRunProjectionStore) canonicalFinalizationRecordsLocked(
	run execution.DurableRun,
	result execution.StepResultProjection,
) (execution.RunStepProjection, execution.StepAttemptProjection, execution.StepResultProjection, error) {
	step, exists := s.runSteps[execution.RunStepKey(run.RequestID, result.StepID)]
	if !exists {
		return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
			execution.RunFinalizationConflict("canonical finalization step is missing")
	}
	attempt, exists := s.stepAttempts[execution.StepAttemptKey(run.RequestID, result.AttemptID)]
	if !exists {
		return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
			execution.RunFinalizationConflict("canonical finalization attempt is missing")
	}
	for _, current := range s.stepAttempts {
		if current.AttemptID == attempt.AttemptID &&
			(current.RequestID != attempt.RequestID || current.StepID != attempt.StepID) {
			return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
				execution.RunFinalizationConflict(
					"canonical attempt_id is also bound to run %s step %s",
					current.RequestID,
					current.StepID,
				)
		}
	}
	for _, current := range s.stepResults {
		if current.ResultID == result.ResultID &&
			(current.RequestID != result.RequestID || current.StepID != result.StepID) {
			return execution.RunStepProjection{}, execution.StepAttemptProjection{}, execution.StepResultProjection{},
				execution.RunFinalizationConflict(
					"canonical result_id is also bound to run %s step %s",
					current.RequestID,
					current.StepID,
				)
		}
	}
	return step, attempt, result, nil
}

func (s *InMemoryRunProjectionStore) completionWonCancellationLocked(
	requestID string,
	now time.Time,
) (execution.RunCancellationCommand, bool, error) {
	command, exists := s.cancellationCommands[requestID]
	if !exists {
		return execution.RunCancellationCommand{}, false, nil
	}
	command, err := execution.CompletionWonCancellationCommand(command, now)
	if err != nil {
		return execution.RunCancellationCommand{}, false, err
	}
	return command, true, nil
}

func (s *InMemoryRunProjectionStore) validateCandidateFinalizationWritesLocked(
	request execution.RunProjectionFinalizeRequest,
) error {
	stepKey := execution.RunStepKey(request.Step.RequestID, request.Step.StepID)
	if current, exists := s.runSteps[stepKey]; exists &&
		!execution.RunStepProjectionUpdateAllowed(current, request.Step) {
		return execution.RunFinalizationConflict("candidate finalization step conflicts with the canonical step")
	}

	for _, current := range s.stepAttempts {
		if current.AttemptID == request.Attempt.AttemptID &&
			(current.RequestID != request.Attempt.RequestID || current.StepID != request.Attempt.StepID) {
			return execution.RunFinalizationConflict(
				"candidate attempt_id is already bound to run %s step %s",
				current.RequestID,
				current.StepID,
			)
		}
		if current.RequestID == request.Attempt.RequestID &&
			current.StepID == request.Attempt.StepID &&
			current.Attempt == request.Attempt.Attempt &&
			current.AttemptID != request.Attempt.AttemptID {
			return execution.RunFinalizationConflict(
				"candidate attempt number is already bound to attempt_id %s",
				current.AttemptID,
			)
		}
	}
	attemptKey := execution.StepAttemptKey(request.Attempt.RequestID, request.Attempt.AttemptID)
	if current, exists := s.stepAttempts[attemptKey]; exists &&
		!execution.StepAttemptProjectionUpdateAllowed(current, request.Attempt) {
		return execution.RunFinalizationConflict("candidate finalization attempt conflicts with the canonical attempt")
	}

	for _, current := range s.stepResults {
		if current.ResultID == request.Result.ResultID {
			return execution.RunFinalizationConflict(
				"candidate result_id is already bound to run %s step %s",
				current.RequestID,
				current.StepID,
			)
		}
	}
	return nil
}

func cloneRunProjectionFinalizeResult(
	run execution.DurableRun,
	step execution.RunStepProjection,
	attempt execution.StepAttemptProjection,
	result execution.StepResultProjection,
) execution.RunProjectionFinalizeResult {
	return execution.RunProjectionFinalizeResult{
		Run:     execution.CloneDurableRun(run),
		Step:    execution.CloneRunStepProjection(step),
		Attempt: execution.CloneStepAttemptProjection(attempt),
		Result:  execution.CloneStepResultProjection(result),
	}
}
