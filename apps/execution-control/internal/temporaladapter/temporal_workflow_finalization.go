package temporaladapter

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
)

// WriteWorkflowFinalization is the finalization boundary for the durable
// solve/execute/replan/synthesize workflow. A direct Solve answer and a
// synthesized planned answer share the same product commit path.
func (s *Adapter) WriteWorkflowFinalization(
	ctx context.Context,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	if input.WorkflowResult.Operation != temporalruntime.WorkflowOperationSolve &&
		input.WorkflowResult.Operation != temporalruntime.WorkflowOperationSynthesize {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_input_invalid",
			errors.New("workflow finalization requires a solve answer or synthesize result"),
			true,
		)
	}
	if strings.TrimSpace(input.WorkflowResult.RequestID) != strings.TrimSpace(input.RequestID) {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_input_invalid",
			errors.New("workflow result request identity is invalid"),
			true,
		)
	}
	return s.writeWorkflowFinalizationActivity(ctx, input)
}

func (s *Adapter) writeWorkflowFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	finalizedAt := input.FinalizedAt.UTC().Truncate(time.Microsecond)
	if finalizedAt.IsZero() {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_input_invalid",
			errors.New("finalized_at is required"),
			true,
		)
	}
	workflowResult := input.WorkflowResult
	agentResult := workflowFinalizationResultMap(input)
	if strings.TrimSpace(workflowResult.WorkflowResultRef) != workflowResultRefForFinalization(input) ||
		strings.TrimSpace(workflowResult.RequestID) != strings.TrimSpace(input.RequestID) {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_input_invalid",
			errors.New("agent result identity is invalid"),
			true,
		)
	}
	run, err := s.temporalActivityRunAllowCompletedWorkflowFinalization(
		ctx,
		input.RequestID,
	)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return s.repairCompletedWorkflowFinalization(ctx, run, input, finalizedAt)
	}
	finalizationStartedAt := time.Now().UTC()
	if err := s.appendTemporalRunProgress(
		ctx,
		run,
		execution.DurableRunProgressPhaseFinalizing,
		finalizationStartedAt,
	); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	replayEvidence, err := s.completedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	expectedToolContract := execution.CloneAnyMapFromValue(agentResult["admitted_tool_contract_fingerprint"])
	if len(expectedToolContract) == 0 && activity.IsActivity(ctx) {
		return s.failFinalizationActivity(
			ctx,
			run,
			"",
			"tool_contract_mismatch",
			"tool_contract_mismatch",
			errors.New("admitted tool contract fingerprint is unavailable"),
		)
	}
	if len(expectedToolContract) > 0 {
		if err := s.validateLocalToolContractFingerprintMap(expectedToolContract); err != nil {
			return s.failFinalizationActivity(
				ctx,
				run,
				"",
				"tool_contract_mismatch",
				"tool_contract_mismatch",
				err,
			)
		}
	}
	if toolName, failCloseReason, err := validateWorkflowResultSucceeded(agentResult); err != nil {
		return s.failFinalizationActivity(
			ctx,
			run,
			toolName,
			"agent_tool_result_failed",
			failCloseReason,
			err,
		)
	}
	if replayEvidence != nil {
		finalizationStartedAt = replayEvidence.StartedAt
	}
	finalizationRef := temporalProjectionRef(run.RequestID, "finalization/write")
	completedAt := finalizedAt
	finalizedResponse, err := s.workflowFinalizedResponse(
		ctx,
		run,
		agentResult,
	)
	if err != nil {
		failureKind := "agent_finalization_invalid"
		var citationError *workflowCitationValidationError
		if errors.As(err, &citationError) {
			failureKind = "citation_validation_failed"
		}
		return s.failFinalizationActivity(ctx, run, "", failureKind, "", err)
	}
	writeProductFinalization := s.productFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = s.writeChatProductFinalization
	}
	if err := writeProductFinalization(ctx, run, completedAt, finalizedResponse); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if err := s.appendTemporalFinalizationCompletedEvents(ctx, run, completedAt, finalizedResponse, map[string]any{
		"workflow_result_ref": workflowResult.WorkflowResultRef,
		"request_id":          run.RequestID,
	}); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	terminalReason := workflowTerminalReason(agentResult)
	projectionCompletedAt := time.Now().UTC()
	if replayEvidence != nil {
		projectionCompletedAt = replayEvidence.CompletedAt
	}
	projectionRun := run
	projectionRun.FinalResponseRef = finalizationRef
	projectionRun.TerminalReason = terminalReason
	completedRun, err := s.commitWorkflowFinalizationStep(
		ctx,
		projectionRun,
		input,
		finalizationStartedAt,
		projectionCompletedAt,
		completedAt,
		finalizedResponse,
		replayEvidence,
	)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if err := s.appendWorkflowRunCompletedEvent(ctx, completedRun, completedAt); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	return temporalruntime.WorkflowFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: temporalProjectionRef(completedRun.RequestID, "finalization/write"),
		RequestID:     completedRun.RequestID,
		Status:        string(completedRun.Status),
	}, nil
}

func workflowResultRefForFinalization(input temporalruntime.WriteWorkflowFinalizationActivityInput) string {
	if input.WorkflowResult.Operation == temporalruntime.WorkflowOperationSolve {
		return workflowOperationResultRef(input.RequestID, "solve.initial")
	}
	return workflowOperationResultRef(input.RequestID, "answer.synthesize")
}

func (s *Adapter) commitWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	startedAt time.Time,
	projectionCompletedAt time.Time,
	runCompletedAt time.Time,
	finalizedResponse map[string]any,
	replayEvidence ...*finalizationProjectionEvidence,
) (execution.DurableRun, error) {
	projection := temporalStepProjection{
		Attempt:       1,
		Tool:          "",
		Run:           run,
		Status:        "completed",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   projectionCompletedAt,
		UpdatedAt:     projectionCompletedAt,
		ResultKind:    "final_answer_projection",
		ProjectionRef: run.FinalResponseRef,
		Payload:       temporalFinalizationResultPayload(finalizedResponse, input, run),
	}
	if len(replayEvidence) > 0 && replayEvidence[0] != nil {
		projection = replayEvidence[0].apply(projection)
	}
	projection = s.withTemporalActivityEvidence(ctx, projection, projection.Attempt)
	projection.Payload = temporalStepProjectionPayload(projection)
	attempt := projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	updatedAt := projection.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}
	attemptID := temporalStepAttemptID(run.RequestID, projection.StepID, attempt)
	finalizationFingerprint := strings.TrimSpace(
		execution.StringValue(projection.Payload["finalization_fingerprint_sha256"]),
	)
	finalized, err := s.runProjectionStore.FinalizeRunProjection(
		ctx,
		execution.RunProjectionFinalizeRequest{
			Completion: execution.DurableRunCompleteRequest{
				FinalResponseRef: run.FinalResponseRef,
				Now:              runCompletedAt,
				RequestID:        run.RequestID,
				TerminalReason:   run.TerminalReason,
			},
			Step: execution.RunStepProjection{
				StepID:               projection.StepID,
				RequestID:            run.RequestID,
				ConversationID:       run.ConversationID,
				StepKind:             projection.StepKind,
				Tool:                 projection.Tool,
				Status:               projection.Status,
				ActivityAttempt:      projection.ActivityAttempt,
				TaskQueue:            projection.TaskQueue,
				WorkerID:             projection.WorkerID,
				StartedAt:            projection.StartedAt,
				CompletedAt:          projection.CompletedAt,
				UpdatedAt:            updatedAt,
				PayloadSchemaVersion: "run-step-projection-v1",
				SanitizedPayload:     projection.Payload,
			},
			Attempt: execution.StepAttemptProjection{
				AttemptID:             attemptID,
				StepID:                projection.StepID,
				RequestID:             run.RequestID,
				Attempt:               attempt,
				Status:                projection.Status,
				TaskQueue:             projection.TaskQueue,
				WorkerID:              projection.WorkerID,
				WorkflowID:            projection.WorkflowID,
				TemporalRunID:         projection.TemporalRunID,
				ActivityID:            projection.ActivityID,
				ActivityType:          projection.ActivityType,
				ActivityAttempt:       projection.ActivityAttempt,
				ScheduledAt:           projection.ScheduledAt,
				StartedAt:             projection.StartedAt,
				CompletedAt:           projection.CompletedAt,
				ScheduleToStartMS:     projection.ScheduleToStartMS,
				DurationMS:            projection.DurationMS,
				ProviderRequestRef:    projection.ProviderRequestRef,
				ProviderResponseID:    projection.ProviderResponseID,
				ModelProvider:         projection.ModelProvider,
				ModelName:             projection.ModelName,
				InputTokens:           projection.InputTokens,
				OutputTokens:          projection.OutputTokens,
				CachedInputTokens:     projection.CachedInputTokens,
				CancelOutcome:         projection.CancelOutcome,
				TimeoutOutcome:        projection.TimeoutOutcome,
				LateCompletionOutcome: projection.LateCompletionOutcome,
				FailCloseReason:       projection.FailCloseReason,
				TerminalReason:        projection.TerminalReason,
				UpdatedAt:             updatedAt,
				PayloadSchemaVersion:  "step-attempt-projection-v1",
				SanitizedPayload:      projection.Payload,
			},
			Result: execution.StepResultProjection{
				ResultID:             temporalStepResultID(run.RequestID, projection.StepID, attempt),
				StepID:               projection.StepID,
				RequestID:            run.RequestID,
				AttemptID:            attemptID,
				Status:               projection.Status,
				ResultKind:           projection.ResultKind,
				ProjectionRef:        projection.ProjectionRef,
				CreatedAt:            updatedAt,
				PayloadSchemaVersion: "step-result-projection-v1",
				SanitizedPayload:     projection.Payload,
			},
			FinalizationFingerprintSHA256: finalizationFingerprint,
		},
	)
	if err != nil {
		if errors.Is(err, execution.ErrRunFinalizationConflict) {
			return execution.DurableRun{}, sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				err,
				true,
			)
		}
		return execution.DurableRun{}, err
	}
	return finalized.Run, nil
}

func (s *Adapter) projectWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	startedAt time.Time,
	completedAt time.Time,
	finalizedResponse map[string]any,
	replayEvidence ...*finalizationProjectionEvidence,
) error {
	projection := temporalStepProjection{
		Attempt:       1,
		Tool:          "",
		Run:           run,
		Status:        "completed",
		StepID:        "finalization.write",
		StepKind:      "finalization",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "final_answer_projection",
		ProjectionRef: run.FinalResponseRef,
		Payload:       temporalFinalizationResultPayload(finalizedResponse, input, run),
	}
	if len(replayEvidence) > 0 && replayEvidence[0] != nil {
		projection = replayEvidence[0].apply(projection)
	}
	return s.projectTemporalStep(ctx, projection)
}

type finalizationProjectionEvidence struct {
	ActivityAttempt   int
	ActivityID        string
	ActivityType      string
	Attempt           int
	CompletedAt       time.Time
	DurationMS        int64
	ScheduledAt       time.Time
	ScheduleToStartMS int64
	StartedAt         time.Time
	TemporalRunID     string
	UpdatedAt         time.Time
	WorkerID          string
	WorkflowID        string
}

func (e *finalizationProjectionEvidence) apply(
	projection temporalStepProjection,
) temporalStepProjection {
	projection.ActivityAttempt = e.ActivityAttempt
	projection.ActivityID = e.ActivityID
	projection.ActivityType = e.ActivityType
	projection.Attempt = e.Attempt
	projection.CompletedAt = e.CompletedAt
	projection.DurationMS = e.DurationMS
	projection.PreserveAttempt = true
	projection.ScheduledAt = e.ScheduledAt
	projection.ScheduleToStartMS = e.ScheduleToStartMS
	projection.StartedAt = e.StartedAt
	projection.TemporalRunID = e.TemporalRunID
	projection.UpdatedAt = e.UpdatedAt
	projection.WorkerID = e.WorkerID
	projection.WorkflowID = e.WorkflowID
	return projection
}

func (s *Adapter) completedFinalizationProjectionEvidence(
	ctx context.Context,
	run execution.DurableRun,
) (*finalizationProjectionEvidence, error) {
	steps, err := s.runProjectionStore.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	activityAttempt := 0
	for _, step := range steps {
		if step.StepID == "finalization.write" && step.Status == "completed" {
			activityAttempt = step.ActivityAttempt
			break
		}
	}
	if activityAttempt <= 0 {
		return nil, nil
	}
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	var selected *execution.StepAttemptProjection
	for index := range attempts {
		attempt := attempts[index]
		if attempt.StepID != "finalization.write" || attempt.Status != "completed" ||
			execution.ProjectionActivityAttempt(attempt) != activityAttempt {
			continue
		}
		if selected == nil || attempt.Attempt > selected.Attempt {
			candidate := attempt
			selected = &candidate
		}
	}
	if selected == nil || selected.Attempt <= 0 || selected.StartedAt.IsZero() ||
		selected.CompletedAt.IsZero() || selected.UpdatedAt.IsZero() {
		return nil, sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("completed finalization attempt evidence is missing"),
			true,
		)
	}
	return &finalizationProjectionEvidence{
		ActivityAttempt:   execution.ProjectionActivityAttempt(*selected),
		ActivityID:        selected.ActivityID,
		ActivityType:      selected.ActivityType,
		Attempt:           selected.Attempt,
		CompletedAt:       selected.CompletedAt,
		DurationMS:        selected.DurationMS,
		ScheduledAt:       selected.ScheduledAt,
		ScheduleToStartMS: selected.ScheduleToStartMS,
		StartedAt:         selected.StartedAt,
		TemporalRunID:     selected.TemporalRunID,
		UpdatedAt:         selected.UpdatedAt,
		WorkerID:          selected.WorkerID,
		WorkflowID:        selected.WorkflowID,
	}, nil
}

func (s *Adapter) repairCompletedWorkflowFinalization(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	finalizedAt time.Time,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	completedAt := run.CompletedAt.UTC().Truncate(time.Microsecond)
	if completedAt.IsZero() || !completedAt.Equal(finalizedAt) {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			fmt.Errorf(
				"completed run finalized_at drift: stored=%s requested=%s",
				completedAt.Format(time.RFC3339Nano),
				finalizedAt.Format(time.RFC3339Nano),
			),
			true,
		)
	}
	finalizedResponse, err := s.completedWorkflowFinalizedResponse(ctx, run)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if err := s.validateCompletedWorkflowFinalizationStep(ctx, run, input, finalizedResponse); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	replayEvidence, err := s.completedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if replayEvidence == nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("completed finalization step and attempt evidence is missing"),
			true,
		)
	}
	agentResult := workflowFinalizationResultMap(input)
	if _, _, err := validateWorkflowResultSucceeded(agentResult); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			err,
			true,
		)
	}
	expectedTerminalReason := workflowTerminalReason(agentResult)
	if run.TerminalReason != expectedTerminalReason {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("completed run terminal identity differs from the workflow agent result"),
			true,
		)
	}
	canonicalRun, err := s.commitWorkflowFinalizationStep(
		ctx,
		run,
		input,
		replayEvidence.StartedAt,
		replayEvidence.CompletedAt,
		completedAt,
		finalizedResponse,
		replayEvidence,
	)
	if err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	if err := s.appendWorkflowRunCompletedEvent(ctx, canonicalRun, completedAt); err != nil {
		return temporalruntime.WorkflowFinalizationActivityOutput{}, err
	}
	return temporalruntime.WorkflowFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: canonicalRun.FinalResponseRef,
		RequestID:     canonicalRun.RequestID,
		Status:        string(canonicalRun.Status),
	}, nil
}

func (s *Adapter) appendWorkflowRunCompletedEvent(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
) error {
	expected := execution.DurableRunEvent{
		EventID:              run.RequestID + ":run-completed",
		RequestID:            run.RequestID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"projection_ref":  run.FinalResponseRef,
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(run.TerminalReason),
		},
	}
	if err := s.appendTemporalRunEvent(ctx, expected); err != nil {
		return err
	}
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID != expected.EventID {
			continue
		}
		if existing.RequestID == expected.RequestID &&
			existing.ConversationID == expected.ConversationID &&
			existing.EventType == expected.EventType &&
			existing.Visibility == expected.Visibility &&
			existing.PayloadSchemaVersion == expected.PayloadSchemaVersion &&
			existing.OccurredAt.UTC().Truncate(time.Microsecond).Equal(expected.OccurredAt) &&
			temporalEventPayloadEquivalent(existing.Payload, expected.Payload) {
			return nil
		}
		return sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("run.completed event identity differs"),
			true,
		)
	}
	return errors.New("run.completed event is missing after append")
}

func (s *Adapter) validateCompletedWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
	finalizedResponse map[string]any,
) error {
	finalizationRef := temporalProjectionRef(run.RequestID, "finalization/write")
	if run.FinalResponseRef != finalizationRef || strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) == "" {
		return sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("completed run finalization identity differs"),
			true,
		)
	}
	results, err := s.runProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if len(finalizedResponse) == 0 {
		return sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("completed run finalization response projection is missing"),
			true,
		)
	}
	expectedPayload := temporalFinalizationResultPayload(finalizedResponse, input, run)
	completedResults := 0
	for _, result := range results {
		if result.StepID != "finalization.write" || result.Status != "completed" {
			continue
		}
		completedResults++
		activityAttempt, valid := execution.PositiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !valid || result.ResultID != temporalStepResultID(run.RequestID, result.StepID, activityAttempt) ||
			result.AttemptID != temporalStepAttemptID(run.RequestID, result.StepID, activityAttempt) ||
			result.RequestID != run.RequestID || result.ResultKind != "final_answer_projection" ||
			result.ProjectionRef != finalizationRef ||
			result.PayloadSchemaVersion != "step-result-projection-v1" {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("completed finalization result identity differs"),
				true,
			)
		}
		expected := execution.CloneAnyMapFromValue(expectedPayload)
		expected["activity_attempt"] = activityAttempt
		if sha256AnyValue(result.SanitizedPayload) != sha256AnyValue(expected) {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("completed finalization result fingerprint differs"),
				true,
			)
		}
	}
	if completedResults != 1 {
		return sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			fmt.Errorf("completed finalization result count is %d", completedResults),
			true,
		)
	}
	return nil
}

func (s *Adapter) completedWorkflowFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		if event.EventID != run.RequestID+":finalization-completed-internal" {
			continue
		}
		response := execution.CloneAnyMapFromValue(event.Payload["response"])
		if len(response) > 0 {
			return response, nil
		}
		break
	}
	return nil, sanitizedTemporalApplicationError(
		"finalization_replay_incomplete",
		errors.New("completed run finalization response projection is missing"),
		true,
	)
}

func validateWorkflowResultSucceeded(agentResult map[string]any) (string, string, error) {
	status := strings.TrimSpace(execution.StringValue(agentResult["status"]))
	if status != "completed" {
		return "", "agent_runtime_incomplete", fmt.Errorf("workflow result status is %q", status)
	}
	expectedFingerprint := execution.CloneAnyMapFromValue(agentResult["admitted_tool_contract_fingerprint"])
	if len(expectedFingerprint) > 0 {
		actualFingerprint := execution.CloneAnyMapFromValue(agentResult["tool_contract_fingerprint"])
		if len(actualFingerprint) == 0 ||
			execution.HashAdmissionJSON(expectedFingerprint) != execution.HashAdmissionJSON(actualFingerprint) {
			return "", "tool_contract_mismatch", errors.New(
				"persisted workflow runtime tool contract does not match admission",
			)
		}
	}
	return "", "", nil
}

func (s *Adapter) workflowFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	workflowResult map[string]any,
	additionalStageTiming ...stageTimingDuration,
) (map[string]any, error) {
	answerText, ok := workflowResult["final_output"].(string)
	if !ok || strings.TrimSpace(answerText) == "" {
		return nil, fmt.Errorf("workflow final_output is required")
	}
	citationClosure, err := s.workflowCitationClosureForFinalization(workflowResult, answerText)
	if err != nil {
		return nil, err
	}
	stageTiming, err := s.stageTimingForRun(
		ctx,
		run,
		execution.CloneAnyMapFromValue(workflowResult["stage_timing"]),
		additionalStageTiming...,
	)
	if err != nil {
		return nil, err
	}
	observability := map[string]any{
		"agent_runtime":   "openai_agents_sdk",
		"model_name":      workflowResult["model_name"],
		"model_provider":  workflowResult["model_provider"],
		"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}
	result := map[string]any{
		"sources":         citationClosure.Sources,
		"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}
	modelUsage, err := workflowModelUsage(workflowResult)
	if err != nil {
		return nil, err
	}
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		Status:        "completed",
		AnswerText:    citationClosure.AnswerText,
		Error:         nil,
		ModelUsage:    modelUsage,
		StageTiming:   stageTiming,
		Result:        result,
		Observability: observability,
	}), nil
}

func workflowModelUsage(workflowResult map[string]any) (ModelUsageWire, error) {
	usage := execution.CloneAnyMapFromValue(workflowResult["usage"])
	result := ModelUsageWire{
		InputTokens:       int64(intFromAny(usage["input_tokens"])),
		CachedInputTokens: int64(intFromAny(usage["cached_input_tokens"])),
		OutputTokens:      int64(intFromAny(usage["output_tokens"])),
	}
	result.TotalTokens = result.InputTokens + result.OutputTokens
	if result.InputTokens < 0 || result.CachedInputTokens < 0 || result.OutputTokens < 0 ||
		result.CachedInputTokens > result.InputTokens {
		return ModelUsageWire{}, errors.New("agent model usage is invalid")
	}
	return result, nil
}

func workflowTerminalReason(workflowResult map[string]any) execution.DurableTerminalReason {
	return execution.DurableTerminalReasonAnswerCompleted
}

func workflowToolResultMaps(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, typed...)
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			result := execution.CloneAnyMapFromValue(item)
			if len(result) > 0 {
				items = append(items, result)
			}
		}
		return items
	default:
		return []map[string]any{}
	}
}

func stringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string{}, typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return []string{}
	}
}
