package execution

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

// repairWorkflowOperationReplayProjection closes the write window between a
// completed invocation receipt and the operation's diagnostic projections.
// The receipt is deliberately committed first so a provider side effect is
// never repeated; a later Activity delivery must therefore repair projections
// before returning the stored operation result to the workflow.
func (s *Adapter) RepairWorkflowOperationReplayProjection(
	ctx context.Context,
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	receipt execution.AgentInvocationReceipt,
	output temporalruntime.WorkflowOperationActivityOutput,
) error {
	if err := ValidateWorkflowOperationReplayOutput(run, request, output); err != nil {
		return err
	}
	if receipt.CompletedAt.IsZero() {
		return fmt.Errorf("completed workflow operation receipt has no completed_at")
	}

	steps, err := s.RunProjectionStore.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return err
	}
	step, found := WorkflowOperationReplayStep(steps, request.StepID)
	if !found {
		return fmt.Errorf("workflow operation replay step %s is missing", request.StepID)
	}
	attempts, err := s.RunProjectionStore.ListStepAttempts(ctx, run.RequestID)
	if err != nil {
		return err
	}
	identity, existingAttempt, attemptNumber := WorkflowOperationReplayIdentity(step, attempts, s.Config.TemporalWorkerIdentity)
	completedAt := receipt.CompletedAt.UTC().Truncate(time.Microsecond)

	switch strings.TrimSpace(step.Status) {
	case "started":
		resultPayload, payloadErr := WorkflowOperationResultPayload(
			request,
			output,
			receipt.InputSHA256,
			identity.ActivityAttempt,
			strings.TrimSpace(s.Config.DeploymentRelease),
		)
		if payloadErr != nil {
			return payloadErr
		}
		startedAt := identity.StartedAt
		if startedAt.IsZero() {
			startedAt = step.StartedAt
		}
		projection := identity.Apply(activityprojection.TemporalStepProjection{
			Attempt:            attemptNumber,
			CompletedAt:        completedAt,
			ModelName:          output.ModelName,
			ModelProvider:      output.ModelProvider,
			ModelRequestCount:  output.Usage.ModelRequestCount,
			InputTokens:        output.Usage.InputTokens,
			OutputTokens:       output.Usage.OutputTokens,
			CachedInputTokens:  output.Usage.CachedInputTokens,
			UsageObserved:      output.Usage.UsageObserved,
			ProviderResponseID: output.ProviderResponseID,
			ProjectionRef:      activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID),
			ResultKind:         WorkflowOperationResultKind(request.Operation),
			Run:                run,
			StartedAt:          startedAt,
			Status:             "completed",
			StepID:             request.StepID,
			StepKind:           execution.FirstNonEmptyText(step.StepKind, request.StepKind),
			TaskQueue:          execution.FirstNonEmptyText(step.TaskQueue, temporalruntime.ActivityTaskQueueAgent),
			TerminalReason:     output.TerminalReason,
			UpdatedAt:          completedAt,
			WorkerID:           execution.FirstNonEmptyText(step.WorkerID, identity.WorkerID, s.Config.TemporalWorkerIdentity),
			Payload:            resultPayload,
		})
		if err := s.ProjectTemporalStep(ctx, projection); err != nil {
			return err
		}
	case "completed":
		// The aggregate step can be durable even when the process stopped in
		// the middle of projectTemporalStep. Preserve its stored payload and
		// timestamps so filling the missing child rows remains idempotent.
		payload := execution.CloneAnyMapFromValue(step.SanitizedPayload)
		if payload == nil {
			payload = map[string]any{}
		}
		if existingAttempt == nil || strings.TrimSpace(existingAttempt.Status) == "started" {
			attempt := WorkflowOperationReplayAttemptProjection(
				run,
				request,
				output,
				step,
				identity,
				attemptNumber,
				existingAttempt,
				payload,
				completedAt,
			)
			if _, err := s.RunProjectionStore.UpsertStepAttempt(ctx, attempt); err != nil {
				return err
			}
		} else if strings.TrimSpace(existingAttempt.Status) != "completed" {
			return fmt.Errorf(
				"workflow operation step %s is completed but its attempt is %s",
				request.StepID,
				existingAttempt.Status,
			)
		}

		results, resultErr := s.RunProjectionStore.ListStepResults(ctx, run.RequestID)
		if resultErr != nil {
			return resultErr
		}
		expectedResultID := activityprojection.TemporalStepResultID(run.RequestID, request.StepID, attemptNumber)
		if !WorkflowOperationReplayHasResult(results, expectedResultID) {
			createdAt := step.CompletedAt
			if createdAt.IsZero() {
				createdAt = completedAt
			}
			if _, err := s.RunProjectionStore.UpsertStepResult(ctx, execution.StepResultProjection{
				ResultID:             expectedResultID,
				StepID:               request.StepID,
				RequestID:            run.RequestID,
				AttemptID:            activityprojection.TemporalStepAttemptID(run.RequestID, request.StepID, attemptNumber),
				Status:               "completed",
				ResultKind:           WorkflowOperationResultKind(request.Operation),
				ProjectionRef:        activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID),
				CreatedAt:            createdAt,
				PayloadSchemaVersion: "step-result-projection-v1",
				SanitizedPayload:     payload,
			}); err != nil {
				return err
			}
		}
	default:
		return fmt.Errorf("workflow operation replay step %s has terminal status %q", request.StepID, step.Status)
	}

	return s.EnsureWorkflowOperationReplayEvent(ctx, run, request, output, completedAt)
}

func ValidateWorkflowOperationReplayOutput(
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
) error {
	if output.Operation != request.Operation {
		return fmt.Errorf("replayed workflow operation %q does not match %q", output.Operation, request.Operation)
	}
	if strings.TrimSpace(output.RequestID) != strings.TrimSpace(run.RequestID) {
		return fmt.Errorf("replayed workflow operation request_id does not match run")
	}
	if strings.TrimSpace(output.WorkflowResultRef) != activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID) {
		return fmt.Errorf("replayed workflow operation result ref does not match step")
	}
	if strings.TrimSpace(output.Status) != "completed" {
		return fmt.Errorf("replayed workflow operation status is %q", output.Status)
	}
	return ValidateWorkflowOperationOutputSources(request, output)
}

func WorkflowOperationReplayStep(
	steps []execution.RunStepProjection,
	stepID string,
) (execution.RunStepProjection, bool) {
	for _, step := range steps {
		if step.StepID == stepID {
			return step, true
		}
	}
	return execution.RunStepProjection{}, false
}

func WorkflowOperationReplayIdentity(
	step execution.RunStepProjection,
	attempts []execution.StepAttemptProjection,
	workerID string,
) (WorkflowProjectionIdentity, *execution.StepAttemptProjection, int) {
	activityAttempt := step.ActivityAttempt
	var selected *execution.StepAttemptProjection
	for index := range attempts {
		candidate := &attempts[index]
		if candidate.StepID != step.StepID {
			continue
		}
		if activityAttempt > 0 && candidate.ActivityAttempt != activityAttempt {
			continue
		}
		if selected == nil || candidate.Attempt > selected.Attempt {
			selected = candidate
		}
	}
	if selected == nil && activityAttempt > 0 {
		for index := range attempts {
			candidate := &attempts[index]
			if candidate.StepID == step.StepID && candidate.Attempt == activityAttempt {
				selected = candidate
				break
			}
		}
	}
	if selected == nil {
		for index := range attempts {
			candidate := &attempts[index]
			if candidate.StepID != step.StepID {
				continue
			}
			if selected == nil || candidate.Attempt > selected.Attempt {
				selected = candidate
			}
		}
	}

	attemptNumber := activityAttempt
	if selected != nil && selected.Attempt > 0 {
		attemptNumber = selected.Attempt
	}
	if attemptNumber <= 0 {
		attemptNumber = 1
	}
	if selected != nil && selected.ActivityAttempt > activityAttempt {
		activityAttempt = selected.ActivityAttempt
	}
	if activityAttempt <= 0 {
		activityAttempt = 1
	}

	identity := WorkflowProjectionIdentity{
		ActivityAttempt: activityAttempt,
		Attempt:         attemptNumber,
		ActivityType:    activityprojection.TemporalActivityTypeForStep(step.StepID),
		PreserveAttempt: true,
		StartedAt:       step.StartedAt,
		WorkerID:        execution.FirstNonEmptyText(step.WorkerID, workerID),
	}
	if selected != nil {
		identity.ActivityID = selected.ActivityID
		identity.ActivityType = execution.FirstNonEmptyText(selected.ActivityType, identity.ActivityType)
		identity.ScheduledAt = selected.ScheduledAt
		identity.ScheduleToStartMS = selected.ScheduleToStartMS
		identity.StartedAt = selected.StartedAt
		identity.TemporalRunID = selected.TemporalRunID
		identity.WorkerID = execution.FirstNonEmptyText(selected.WorkerID, identity.WorkerID)
		identity.WorkflowID = selected.WorkflowID
	}
	return identity, selected, attemptNumber
}

func WorkflowOperationReplayAttemptProjection(
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
	step execution.RunStepProjection,
	identity WorkflowProjectionIdentity,
	attemptNumber int,
	existing *execution.StepAttemptProjection,
	payload map[string]any,
	completedAt time.Time,
) execution.StepAttemptProjection {
	var attempt execution.StepAttemptProjection
	if existing != nil {
		attempt = *existing
	}
	attempt.AttemptID = activityprojection.TemporalStepAttemptID(run.RequestID, request.StepID, attemptNumber)
	attempt.StepID = request.StepID
	attempt.RequestID = run.RequestID
	attempt.Attempt = attemptNumber
	attempt.Status = "completed"
	attempt.TaskQueue = execution.FirstNonEmptyText(attempt.TaskQueue, step.TaskQueue, temporalruntime.ActivityTaskQueueAgent)
	attempt.WorkerID = execution.FirstNonEmptyText(attempt.WorkerID, step.WorkerID, identity.WorkerID)
	attempt.WorkflowID = execution.FirstNonEmptyText(attempt.WorkflowID, identity.WorkflowID, "campus-agent.chat."+run.RequestID)
	attempt.TemporalRunID = execution.FirstNonEmptyText(attempt.TemporalRunID, identity.TemporalRunID)
	attempt.ActivityID = execution.FirstNonEmptyText(attempt.ActivityID, identity.ActivityID)
	attempt.ActivityType = execution.FirstNonEmptyText(attempt.ActivityType, identity.ActivityType, activityprojection.TemporalActivityTypeForStep(request.StepID))
	attempt.ActivityAttempt = identity.ActivityAttempt
	if attempt.ScheduledAt.IsZero() {
		attempt.ScheduledAt = identity.ScheduledAt
	}
	if attempt.StartedAt.IsZero() {
		attempt.StartedAt = identity.StartedAt
	}
	if attempt.StartedAt.IsZero() {
		attempt.StartedAt = step.StartedAt
	}
	attempt.CompletedAt = completedAt
	if attempt.ScheduleToStartMS <= 0 && !attempt.ScheduledAt.IsZero() && !attempt.StartedAt.IsZero() &&
		!attempt.StartedAt.Before(attempt.ScheduledAt) {
		attempt.ScheduleToStartMS = attempt.StartedAt.Sub(attempt.ScheduledAt).Milliseconds()
	}
	if attempt.DurationMS <= 0 && !attempt.StartedAt.IsZero() && !attempt.CompletedAt.IsZero() &&
		!attempt.CompletedAt.Before(attempt.StartedAt) {
		attempt.DurationMS = attempt.CompletedAt.Sub(attempt.StartedAt).Milliseconds()
	}
	attempt.ProviderResponseID = execution.FirstNonEmptyText(output.ProviderResponseID, attempt.ProviderResponseID)
	attempt.ModelProvider = execution.FirstNonEmptyText(output.ModelProvider, attempt.ModelProvider)
	attempt.ModelName = execution.FirstNonEmptyText(output.ModelName, attempt.ModelName)
	attempt.ModelRequestCount = output.Usage.ModelRequestCount
	attempt.InputTokens = output.Usage.InputTokens
	attempt.OutputTokens = output.Usage.OutputTokens
	attempt.CachedInputTokens = output.Usage.CachedInputTokens
	attempt.UsageObserved = output.Usage.UsageObserved
	if attempt.CancelOutcome == "" {
		attempt.CancelOutcome = execution.CancelOutcomeNotRequested
	}
	if attempt.TimeoutOutcome == "" {
		attempt.TimeoutOutcome = execution.TimeoutOutcomeNotTimedOut
	}
	if attempt.LateCompletionOutcome == "" {
		attempt.LateCompletionOutcome = execution.LateCompletionOutcomeNotLate
	}
	attempt.TerminalReason = execution.FirstNonEmptyText(output.TerminalReason, attempt.TerminalReason)
	attempt.UpdatedAt = completedAt
	attempt.PayloadSchemaVersion = "step-attempt-projection-v1"
	attempt.SanitizedPayload = execution.CloneAnyMapFromValue(payload)
	return attempt
}

func WorkflowOperationReplayHasResult(results []execution.StepResultProjection, resultID string) bool {
	for _, result := range results {
		if result.ResultID == resultID {
			return true
		}
	}
	return false
}

func (s *Adapter) EnsureWorkflowOperationReplayEvent(
	ctx context.Context,
	run execution.DurableRun,
	request WorkflowOperationActivityRequest,
	output temporalruntime.WorkflowOperationActivityOutput,
	completedAt time.Time,
) error {
	event := execution.DurableRunEvent{
		EventID:              run.RequestID + ":" + request.StepID + ":completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeWorkflowOperationCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "workflow-operation-event-v1",
		Payload: map[string]any{
			"operation":  string(request.Operation),
			"result_ref": activityprojection.WorkflowOperationResultRef(run.RequestID, request.StepID),
			"step_id":    request.StepID,
			"status":     output.Status,
		},
	}
	return s.AppendTemporalRunEvent(ctx, event)
}
