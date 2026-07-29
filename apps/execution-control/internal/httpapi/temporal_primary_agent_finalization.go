package httpapi

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

func (s *Server) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	return s.writePrimaryAgentFinalizationActivity(ctx, input)
}

func (s *Server) writePrimaryAgentFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	finalizedAt := input.FinalizedAt.UTC().Truncate(time.Microsecond)
	if finalizedAt.IsZero() {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_input_invalid",
			errors.New("finalized_at is required"),
			true,
		)
	}
	run, err := s.temporalActivityRunAllowCompletedAgentFinalization(
		ctx,
		input.RunID,
		input.TraceID,
		input.AgentResultRef,
	)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return s.repairCompletedPrimaryAgentFinalization(ctx, run, input, finalizedAt)
	}
	replayEvidence, err := s.completedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	agentResult, err := s.temporalAgentResultFromRun(ctx, run, input.AgentResultRef)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "", "agent_result_missing", "", err)
	}
	expectedToolRuntime := cloneAnyMapFromMetadata(agentResult["admitted_tool_runtime_fingerprint"])
	if len(expectedToolRuntime) == 0 && activity.IsActivity(ctx) {
		return s.failFinalizationActivity(
			ctx,
			run,
			"",
			"agent_runtime_fingerprint_mismatch",
			"agent_runtime_fingerprint_mismatch",
			errors.New("admitted tool runtime fingerprint is unavailable"),
		)
	}
	if len(expectedToolRuntime) > 0 {
		if err := s.validateLocalToolRuntimeFingerprintMap(expectedToolRuntime); err != nil {
			return s.failFinalizationActivity(
				ctx,
				run,
				"",
				"agent_runtime_fingerprint_mismatch",
				"agent_runtime_fingerprint_mismatch",
				err,
			)
		}
	}
	if toolName, failCloseReason, err := validatePrimaryAgentResultSucceeded(agentResult); err != nil {
		return s.failFinalizationActivity(
			ctx,
			run,
			toolName,
			"agent_tool_result_failed",
			failCloseReason,
			err,
		)
	}
	finalizationStartedAt := time.Now().UTC()
	if replayEvidence != nil {
		finalizationStartedAt = replayEvidence.StartedAt
	}
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	completedAt := finalizedAt
	finalizedResponse, err := s.primaryAgentFinalizedResponse(
		ctx,
		run,
		agentResult,
	)
	if err != nil {
		return s.failFinalizationActivity(ctx, run, "", "agent_finalization_invalid", "", err)
	}
	writeProductFinalization := s.productFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = s.writeChatProductFinalization
	}
	if err := writeProductFinalization(ctx, run, completedAt, finalizedResponse); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.appendTemporalFinalizationCompletedEvents(ctx, run, completedAt, finalizedResponse, map[string]any{
		"agent_result_ref": input.AgentResultRef,
		"request_id":       run.RequestID,
		"trace_id":         run.TraceID,
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	terminalReason := primaryAgentTerminalReason(agentResult)
	projectionCompletedAt := time.Now().UTC()
	if replayEvidence != nil {
		projectionCompletedAt = replayEvidence.CompletedAt
	}
	projectionRun := run
	projectionRun.FinalResponseRef = finalizationRef
	projectionRun.TerminalReason = terminalReason
	completedRun, err := s.commitPrimaryAgentFinalizationStep(
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
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.appendPrimaryAgentRunCompletedEvent(ctx, completedRun, completedAt); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	return temporalruntime.WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: temporalProjectionRef(completedRun.RunID, "finalization/write"),
		RunID:         completedRun.RunID,
		Status:        string(completedRun.Status),
	}, nil
}

func (s *Server) commitPrimaryAgentFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteFinalizationActivityInput,
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
	attemptID := temporalStepAttemptID(run.RunID, projection.StepID, attempt)
	finalizationFingerprint := strings.TrimSpace(
		stringValue(projection.Payload["finalization_fingerprint_sha256"]),
	)
	finalized, err := s.runProjectionStore.FinalizeRunProjection(
		ctx,
		execution.RunProjectionFinalizeRequest{
			Completion: execution.DurableRunCompleteRequest{
				FinalResponseRef: run.FinalResponseRef,
				Now:              runCompletedAt,
				RunID:            run.RunID,
				TerminalReason:   run.TerminalReason,
			},
			Step: execution.RunStepProjection{
				StepID:               projection.StepID,
				RunID:                run.RunID,
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
				RunID:                 run.RunID,
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
				ResultID:             temporalStepResultID(run.RunID, projection.StepID, attempt),
				StepID:               projection.StepID,
				RunID:                run.RunID,
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
	if err := s.emitTemporalStepObservation(ctx, projection); err != nil {
		return execution.DurableRun{}, err
	}
	return finalized.Run, nil
}

func (s *Server) projectPrimaryAgentFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteFinalizationActivityInput,
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

func (s *Server) completedFinalizationProjectionEvidence(
	ctx context.Context,
	run execution.DurableRun,
) (*finalizationProjectionEvidence, error) {
	steps, err := s.runProjectionStore.ListRunSteps(ctx, run.RunID)
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
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, run.RunID)
	if err != nil {
		return nil, err
	}
	var selected *execution.StepAttemptProjection
	for index := range attempts {
		attempt := attempts[index]
		if attempt.StepID != "finalization.write" || attempt.Status != "completed" ||
			projectionActivityAttempt(attempt) != activityAttempt {
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
		ActivityAttempt:   projectionActivityAttempt(*selected),
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

func (s *Server) repairCompletedPrimaryAgentFinalization(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteFinalizationActivityInput,
	finalizedAt time.Time,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	completedAt := run.CompletedAt.UTC().Truncate(time.Microsecond)
	if completedAt.IsZero() || !completedAt.Equal(finalizedAt) {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			fmt.Errorf(
				"completed run finalized_at drift: stored=%s requested=%s",
				completedAt.Format(time.RFC3339Nano),
				finalizedAt.Format(time.RFC3339Nano),
			),
			true,
		)
	}
	finalizedResponse, err := s.completedPrimaryAgentFinalizedResponse(ctx, run)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.validateCompletedPrimaryAgentFinalizationStep(ctx, run, input, finalizedResponse); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	replayEvidence, err := s.completedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if replayEvidence == nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_incomplete",
			errors.New("completed finalization step and attempt evidence is missing"),
			true,
		)
	}
	agentResult, err := s.temporalAgentResultFromRun(ctx, run, input.AgentResultRef)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			err,
			true,
		)
	}
	if _, _, err := validatePrimaryAgentResultSucceeded(agentResult); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			err,
			true,
		)
	}
	expectedTerminalReason := primaryAgentTerminalReason(agentResult)
	if run.TerminalReason != expectedTerminalReason {
		return temporalruntime.WriteFinalizationActivityOutput{}, sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("completed run terminal identity differs from the protected agent result"),
			true,
		)
	}
	canonicalRun, err := s.commitPrimaryAgentFinalizationStep(
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
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if err := s.appendPrimaryAgentRunCompletedEvent(ctx, canonicalRun, completedAt); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	return temporalruntime.WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: canonicalRun.FinalResponseRef,
		RunID:         canonicalRun.RunID,
		Status:        string(canonicalRun.Status),
	}, nil
}

func (s *Server) appendPrimaryAgentRunCompletedEvent(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
) error {
	expected := execution.DurableRunEvent{
		EventID:              run.RunID + ":run-completed",
		RunID:                run.RunID,
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
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RunID)
	if err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID != expected.EventID {
			continue
		}
		if existing.RunID == expected.RunID &&
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

func (s *Server) validateCompletedPrimaryAgentFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.WriteFinalizationActivityInput,
	finalizedResponse map[string]any,
) error {
	finalizationRef := temporalProjectionRef(run.RunID, "finalization/write")
	if run.FinalResponseRef != finalizationRef || strings.TrimSpace(input.AgentResultRef) == "" {
		return sanitizedTemporalApplicationError(
			"finalization_replay_conflict",
			errors.New("completed run finalization identity differs"),
			true,
		)
	}
	results, err := s.runProjectionStore.ListStepResults(ctx, run.RunID)
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
		activityAttempt, valid := positiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !valid || result.ResultID != temporalStepResultID(run.RunID, result.StepID, activityAttempt) ||
			result.AttemptID != temporalStepAttemptID(run.RunID, result.StepID, activityAttempt) ||
			result.RunID != run.RunID || result.ResultKind != "final_answer_projection" ||
			result.ProjectionRef != finalizationRef ||
			result.PayloadSchemaVersion != "step-result-projection-v1" {
			return sanitizedTemporalApplicationError(
				"finalization_replay_conflict",
				errors.New("completed finalization result identity differs"),
				true,
			)
		}
		expected := cloneAnyMapFromMetadata(expectedPayload)
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

func (s *Server) completedPrimaryAgentFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	events, err := s.runProjectionStore.ListRunEvents(ctx, run.RunID)
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		if event.EventID != run.RunID+":finalization-completed-internal" {
			continue
		}
		response := cloneAnyMapFromMetadata(event.Payload["response"])
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

func validatePrimaryAgentResultSucceeded(agentResult map[string]any) (string, string, error) {
	status := strings.TrimSpace(stringValue(agentResult["status"]))
	if status != "completed" {
		return "", "agent_runtime_incomplete", fmt.Errorf("agent result status is %q", status)
	}
	expectedFingerprint := cloneAnyMapFromMetadata(agentResult["admitted_tool_runtime_fingerprint"])
	if len(expectedFingerprint) > 0 {
		actualFingerprint := cloneAnyMapFromMetadata(agentResult["tool_runtime_fingerprint"])
		if len(actualFingerprint) == 0 ||
			hashAdmissionJSON(expectedFingerprint) != hashAdmissionJSON(actualFingerprint) {
			return "", "agent_runtime_fingerprint_mismatch", errors.New(
				"persisted agent runtime tool fingerprint does not match admission",
			)
		}
	}
	for _, toolResult := range primaryAgentToolResultMaps(agentResult["tool_results"]) {
		if primaryAgentToolResultStatus(toolResult) != "failed" {
			continue
		}
		toolName := strings.TrimSpace(stringValue(toolResult["tool_name"]))
		reason := strings.TrimSpace(stringValue(toolResult["fail_close_reason"]))
		if reason == "" {
			reason = "tool_execution_failed"
		}
		return toolName, reason, fmt.Errorf(
			"agent tool result %s failed with fail_close_reason=%s",
			toolName,
			reason,
		)
	}
	return "", "", nil
}

func (s *Server) primaryAgentFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	agentResult map[string]any,
	additionalStageTiming ...stageTimingDuration,
) (map[string]any, error) {
	envelope := cloneAnyMapFromMetadata(agentResult["terminal_envelope"])
	if !validPrimaryAgentTerminalEnvelope(envelope) {
		return nil, fmt.Errorf("agent terminal_envelope is required")
	}
	evidenceClosure, err := s.primaryAgentEvidenceClosureForFinalization(
		ctx,
		run,
		agentResult,
		envelope,
	)
	if err != nil {
		return nil, err
	}
	terminalKind := primaryAgentTerminalKind(envelope)
	answerText := primaryAgentEnvelopeAnswerText(envelope)
	status, followUpQuestion, confidence := primaryAgentResponseFields(terminalKind, answerText)
	stageTiming, err := s.stageTimingForRun(
		ctx,
		run,
		cloneAnyMapFromMetadata(agentResult["stage_timing"]),
		additionalStageTiming...,
	)
	if err != nil {
		return nil, err
	}
	toolAssisted := len(primaryAgentToolResultMaps(agentResult["tool_results"])) > 0
	workflowTraceSummary := map[string]any{
		"execution_path":       primaryAgentExecutionPath(terminalKind, toolAssisted),
		"terminal_reason":      terminalKind,
		"answer_artifact_refs": []string{temporalProjectionRef(run.RunID, "finalization/write")},
		"runtime_versions":     map[string]any{"agent_runtime": "openai_agents_sdk"},
	}
	observability := map[string]any{
		"agent_runtime":   "openai_agents_sdk",
		"model_name":      agentResult["model_name"],
		"model_provider":  agentResult["model_provider"],
		"terminal_reason": terminalKind,
	}
	result := map[string]any{
		"sources":         evidenceClosure.Sources,
		"terminal_reason": terminalKind,
	}
	modelUsage, err := primaryAgentModelUsage(agentResult)
	if err != nil {
		return nil, err
	}
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		Status:               status,
		AnswerText:           primaryAgentAnswerText(status, answerText),
		Error:                primaryAgentErrorBody(status, terminalKind),
		FollowUpQuestion:     followUpQuestion,
		Confidence:           confidence,
		ModelUsage:           modelUsage,
		StageTiming:          stageTiming,
		Result:               result,
		Observability:        observability,
		WorkflowTraceSummary: workflowTraceSummary,
		TraceID:              run.TraceID,
	}), nil
}

func primaryAgentExecutionPath(terminalReason string, toolAssisted bool) string {
	switch terminalReason {
	case "clarification_required":
		return "clarification"
	case "out_of_scope", "policy_refusal":
		return "rejected"
	case "unsupported_by_evidence":
		return "unsupported"
	default:
		if toolAssisted {
			return "tool_assisted"
		}
		return "direct"
	}
}

func primaryAgentModelUsage(agentResult map[string]any) (ModelUsageWire, error) {
	usage := cloneAnyMapFromMetadata(agentResult["usage"])
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

func primaryAgentTerminalReason(agentResult map[string]any) execution.DurableTerminalReason {
	switch primaryAgentTerminalKind(cloneAnyMapFromMetadata(agentResult["terminal_envelope"])) {
	case "clarification_required":
		return execution.DurableTerminalReasonClarificationRequired
	case "out_of_scope", "policy_refusal":
		return execution.DurableTerminalReasonPolicyRejected
	case "unsupported_by_evidence":
		return execution.DurableTerminalReasonNoAnswerGrounded
	default:
		return execution.DurableTerminalReasonAnswerCompleted
	}
}

func primaryAgentResponseFields(terminalReason string, answerText string) (string, string, string) {
	switch terminalReason {
	case "clarification_required":
		return "needs_clarification", answerText, "medium"
	case "out_of_scope", "policy_refusal":
		return "rejected", "", "low"
	case "unsupported_by_evidence":
		return "no_answer", "", "low"
	default:
		return "completed", "", "medium"
	}
}

func primaryAgentErrorBody(status string, terminalReason string) any {
	if status != "rejected" {
		return nil
	}
	code := "request_rejected"
	message := "The request was rejected by execution policy."
	if strings.TrimSpace(terminalReason) == "out_of_scope" {
		message = "The request is outside the current campus assistant scope."
	}
	return map[string]any{
		"code":      code,
		"message":   message,
		"retryable": false,
	}
}

func primaryAgentAnswerText(status string, answerText string) string {
	if status == "needs_clarification" {
		return ""
	}
	return answerText
}

func primaryAgentTerminalKind(envelope map[string]any) string {
	kind := strings.TrimSpace(stringValue(envelope["kind"]))
	if kind == "" {
		return "answer"
	}
	return kind
}

func primaryAgentEnvelopeAnswerText(envelope map[string]any) string {
	kind := primaryAgentTerminalKind(envelope)
	switch kind {
	case "clarification_required":
		if followUp := strings.TrimSpace(stringValue(envelope["follow_up_question"])); followUp != "" {
			return followUp
		}
		return strings.TrimSpace(stringValue(envelope["answer_text"]))
	case "answer":
		return strings.TrimSpace(stringValue(envelope["answer_text"]))
	default:
		if answerText := strings.TrimSpace(stringValue(envelope["answer_text"])); answerText != "" {
			return answerText
		}
		return strings.TrimSpace(stringValue(envelope["reason"]))
	}
}

func primaryAgentToolResultMaps(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return append([]map[string]any{}, typed...)
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			result := cloneAnyMapFromMetadata(item)
			if len(result) > 0 {
				items = append(items, result)
			}
		}
		return items
	default:
		return []map[string]any{}
	}
}

func primaryAgentToolResultStatus(toolResult map[string]any) string {
	result := cloneAnyMapFromMetadata(toolResult["result"])
	if outcome := strings.TrimSpace(stringValue(result["outcome"])); outcome != "" {
		return outcome
	}
	return strings.TrimSpace(stringValue(toolResult["status"]))
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
