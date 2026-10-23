package finalization

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/campusdiagnostics"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionfailure"
)

// WriteWorkflowFinalization is the finalization boundary for the durable
// solve/execute/replan/synthesize workflow. A direct Solve answer and a
// synthesized planned answer share the same product commit path.
func (s *FinalizationService) WriteWorkflowFinalization(
	ctx context.Context,
	input executioncontract.FinalizationInput,
) (executioncontract.FinalizationOutput, error) {
	if input.WorkflowResult.Operation != executioncontract.WorkflowOperationSolve &&
		input.WorkflowResult.Operation != executioncontract.WorkflowOperationSynthesize {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_input_invalid",
			errors.New("workflow finalization requires a solve answer or synthesize result"),
			true,
		)
	}
	if strings.TrimSpace(input.WorkflowResult.RequestID) != strings.TrimSpace(input.RequestID) {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_input_invalid",
			errors.New("workflow result request identity is invalid"),
			true,
		)
	}
	return s.CommitWorkflowFinalization(ctx, input)
}

// Use the finalized sources, not the original answer's indexes: a repeated
// search can assign another index to evidence already retained by the runtime.
func campusSearchCitedRefs(finalizedResponse map[string]any, result executioncontract.OperationOutput) []string {
	refs := []string{}
	evidenceRefs := map[string]string{}
	if result.Operation == executioncontract.WorkflowOperationSynthesize {
		for _, item := range result.Evidence {
			if item.Source == executioncontract.WorkflowSourceCampusSearch {
				evidenceRefs[item.ID] = execution.FirstNonEmptyText(item.ResultRef, item.ID)
			}
		}
	}
	seen := map[string]bool{}
	responseResult := execution.CloneAnyMapFromValue(finalizedResponse["result"])
	for _, source := range WorkflowToolResultMaps(responseResult["sources"]) {
		kind := execution.StringValue(source["kind"])
		if kind != "campus_document" && kind != "campus_notice" {
			continue
		}
		ref := execution.StringValue(source["evidence_ref"])
		if mapped, ok := evidenceRefs[ref]; ok {
			ref = mapped
		}
		if ref != "" && !seen[ref] {
			seen[ref] = true
			refs = append(refs, ref)
		}
	}
	return refs
}

func (s *FinalizationService) CommitWorkflowFinalization(
	ctx context.Context,
	input executioncontract.FinalizationInput,
) (executioncontract.FinalizationOutput, error) {
	workflowResult := input.WorkflowResult
	agentResult := WorkflowFinalizationResultMap(input)
	if strings.TrimSpace(workflowResult.WorkflowResultRef) != WorkflowResultRefForFinalization(input) ||
		strings.TrimSpace(workflowResult.RequestID) != strings.TrimSpace(input.RequestID) {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_input_invalid",
			errors.New("agent result identity is invalid"),
			true,
		)
	}
	run, err := s.TemporalActivityRunAllowCompletedWorkflowFinalization(
		ctx,
		input.RequestID,
	)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	if run.Status == execution.DurableRunStatusCompleted {
		return s.RepairCompletedWorkflowFinalization(ctx, run, input)
	}
	finalizationStartedAt, err := s.EnsureFinalizationProgress(ctx, run)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	replayEvidence, err := s.CompletedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	expectedToolContract := execution.CloneAnyMapFromValue(agentResult["admitted_tool_contract_fingerprint"])
	if len(expectedToolContract) == 0 && s.InvocationEvidence(ctx).Present {
		return s.FailFinalizationActivity(
			ctx,
			run,
			"",
			"tool_contract_mismatch",
			"tool_contract_mismatch",
			errors.New("admitted tool contract fingerprint is unavailable"),
		)
	}
	if len(expectedToolContract) > 0 {
		if err := s.ValidateLocalToolContractFingerprintMap(expectedToolContract); err != nil {
			return s.FailFinalizationActivity(
				ctx,
				run,
				"",
				"tool_contract_mismatch",
				"tool_contract_mismatch",
				err,
			)
		}
	}
	if toolName, failCloseReason, err := ValidateWorkflowResultSucceeded(agentResult); err != nil {
		return s.FailFinalizationActivity(
			ctx,
			run,
			toolName,
			"agent_tool_result_failed",
			failCloseReason,
			err,
		)
	}
	finalizationRef := activityprojection.ProjectionRef(run.RequestID, "finalization/write")
	finalizedResponse, err := s.WorkflowFinalizedResponse(
		ctx,
		run,
		agentResult,
	)
	if err != nil {
		failureKind := "agent_finalization_invalid"
		var citationError *WorkflowCitationValidationError
		if errors.As(err, &citationError) {
			failureKind = "citation_validation_failed"
		}
		return s.FailFinalizationActivity(ctx, run, "", failureKind, "", err)
	}
	// Deterministic rejection must happen before publishing product success.
	if err := validateFinalizationRecoveryResponse(finalizedResponse); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	writeProductFinalization := s.ProductFinalizationWriter
	if writeProductFinalization == nil {
		writeProductFinalization = s.WriteChatProductFinalization
	}
	finalizationPayload := TemporalFinalizationResultPayload(finalizedResponse, input, run)
	finalizationFingerprint := strings.TrimSpace(
		execution.StringValue(finalizationPayload[execution.FinalizationFingerprintPayloadKey]),
	)
	timing, err := s.EnsureFinalizationTimingReservation(
		ctx,
		run,
		input,
		finalizedResponse,
		finalizationStartedAt,
		finalizationFingerprint,
	)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	completedAt := timing.CompletedAt
	if s.PrepareMemoryDelivery != nil {
		if err := s.PrepareMemoryDelivery(ctx, run); err != nil {
			return executioncontract.FinalizationOutput{}, err
		}
	}
	if err := writeProductFinalization(ctx, run, completedAt, finalizedResponse); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	if err := s.AppendTemporalFinalizationCompletedEvents(ctx, run, completedAt, finalizedResponse, map[string]any{
		"workflow_result_ref": workflowResult.WorkflowResultRef,
		"request_id":          run.RequestID,
	}); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	terminalReason := WorkflowTerminalReason(agentResult)
	projectionCompletedAt := CanonicalFinalizationTime(time.Now())
	if replayEvidence != nil {
		projectionCompletedAt = replayEvidence.CompletedAt
	}
	projectionRun := run
	projectionRun.FinalResponseRef = finalizationRef
	projectionRun.TerminalReason = terminalReason
	completedRun, err := s.CommitWorkflowFinalizationStep(
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
		return executioncontract.FinalizationOutput{}, err
	}
	if err := s.AppendWorkflowRunCompletedEvent(ctx, completedRun, completedAt); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	campusdiagnostics.MarkCitations(ctx, s.RunProjectionStore, input.RequestID, campusSearchCitedRefs(finalizedResponse, workflowResult))
	return executioncontract.FinalizationOutput{
		CompletedAt:   completedAt,
		ProjectionRef: activityprojection.ProjectionRef(completedRun.RequestID, "finalization/write"),
		RequestID:     completedRun.RequestID,
		Status:        string(completedRun.Status),
	}, nil
}

func WorkflowResultRefForFinalization(input executioncontract.FinalizationInput) string {
	if input.WorkflowResult.Operation == executioncontract.WorkflowOperationSolve {
		return activityprojection.WorkflowOperationResultRef(input.RequestID, "solve.initial")
	}
	return activityprojection.WorkflowOperationResultRef(input.RequestID, "answer.synthesize")
}

func (s *FinalizationService) CommitWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	startedAt time.Time,
	projectionCompletedAt time.Time,
	runCompletedAt time.Time,
	finalizedResponse map[string]any,
	replayEvidence ...*FinalizationProjectionEvidence,
) (execution.DurableRun, error) {
	canonicalStartedAt := CanonicalFinalizationTime(startedAt)
	completionAt := CanonicalFinalizationTime(runCompletedAt)
	if completionAt.IsZero() {
		completionAt = CanonicalFinalizationTime(projectionCompletedAt)
	}
	canonicalStepCompletedAt := completionAt
	canonicalStepUpdatedAt := completionAt
	canonicalResultCreatedAt := completionAt
	if len(replayEvidence) > 0 && replayEvidence[0] != nil && replayEvidence[0].PreserveCanonicalTiming {
		evidence := replayEvidence[0]
		if !evidence.CanonicalStartedAt.IsZero() {
			canonicalStartedAt = CanonicalFinalizationTime(evidence.CanonicalStartedAt)
		}
		if !evidence.CanonicalCompletedAt.IsZero() {
			canonicalStepCompletedAt = CanonicalFinalizationTime(evidence.CanonicalCompletedAt)
		}
		if !evidence.CanonicalUpdatedAt.IsZero() {
			canonicalStepUpdatedAt = CanonicalFinalizationTime(evidence.CanonicalUpdatedAt)
		}
		if !evidence.CanonicalResultCreatedAt.IsZero() {
			canonicalResultCreatedAt = CanonicalFinalizationTime(evidence.CanonicalResultCreatedAt)
		}
	}
	activityCompletedAt := CanonicalFinalizationTime(projectionCompletedAt)
	if activityCompletedAt.IsZero() {
		activityCompletedAt = CanonicalFinalizationTime(time.Now())
	}
	projection := activityprojection.StepProjection{
		Attempt:            1,
		Tool:               "",
		Run:                run,
		Status:             "completed",
		StepID:             "finalization.write",
		StepKind:           "finalization",
		TaskQueue:          executioncontract.ActivityTaskQueueCore,
		WorkerID:           s.WorkerID,
		StartedAt:          canonicalStartedAt,
		CompletedAt:        canonicalStepCompletedAt,
		AttemptCompletedAt: activityCompletedAt,
		UpdatedAt:          canonicalStepUpdatedAt,
		AttemptUpdatedAt:   activityCompletedAt,
		ResultKind:         "final_answer_projection",
		ProjectionRef:      run.FinalResponseRef,
		Payload:            TemporalFinalizationResultPayload(finalizedResponse, input, run),
	}
	if len(replayEvidence) > 0 && replayEvidence[0] != nil {
		projection = replayEvidence[0].Apply(projection)
	}
	projection = s.WithInvocationEvidence(ctx, projection, projection.Attempt)
	projection.Payload = activityprojection.StepProjectionPayload(projection)
	attempt := projection.Attempt
	if attempt <= 0 {
		attempt = 1
	}
	attemptStartedAt := CanonicalFinalizationTime(projection.AttemptStartedAt)
	attemptCompletedAt := CanonicalFinalizationTime(projection.AttemptCompletedAt)
	attemptUpdatedAt := CanonicalFinalizationTime(projection.AttemptUpdatedAt)
	if attemptStartedAt.IsZero() {
		attemptStartedAt = canonicalStartedAt
	}
	if attemptCompletedAt.IsZero() {
		attemptCompletedAt = activityCompletedAt
	}
	if attemptUpdatedAt.IsZero() {
		attemptUpdatedAt = attemptCompletedAt
	}
	attemptID := activityprojection.StepAttemptID(run.RequestID, projection.StepID, attempt)
	finalizationFingerprint := strings.TrimSpace(
		execution.StringValue(projection.Payload["finalization_fingerprint_sha256"]),
	)

	// External Memory owns append progress; only the local child uses this step.
	if s.PrepareMemoryDelivery == nil {
		// Register the post-answer step before publishing the completed finalization projection.
		// Replayed finalization must not reset an already running/terminal append.
		_, pendingErr := s.RunProjectionStore.UpsertRunStep(ctx, execution.RunStepProjection{
			StepID: "memory.append", RequestID: run.RequestID, ConversationID: run.ConversationID, StepKind: "memory", Tool: "memory",
			Status: "pending", TaskQueue: executioncontract.ActivityTaskQueueCore, UpdatedAt: completionAt,
			PayloadSchemaVersion: "run-step-projection-v1", SanitizedPayload: map[string]any{"status": "pending"},
		})
		if pendingErr != nil && !errors.Is(pendingErr, execution.ErrStaleRunStepProjection) {
			return execution.DurableRun{}, pendingErr
		}
	}
	finalized, err := s.StateWriter.FinalizeRunProjection(
		ctx,
		execution.RunProjectionFinalizeRequest{
			Completion: execution.DurableRunCompleteRequest{
				FinalResponseRef: run.FinalResponseRef,
				Now:              completionAt,
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
				UpdatedAt:            canonicalStepUpdatedAt,
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
				StartedAt:             attemptStartedAt,
				CompletedAt:           attemptCompletedAt,
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
				UpdatedAt:             attemptUpdatedAt,
				PayloadSchemaVersion:  "step-attempt-projection-v1",
				SanitizedPayload:      projection.Payload,
			},
			Result: execution.StepResultProjection{
				ResultID:             activityprojection.StepResultID(run.RequestID, projection.StepID, attempt),
				StepID:               projection.StepID,
				RequestID:            run.RequestID,
				AttemptID:            attemptID,
				Status:               projection.Status,
				ResultKind:           projection.ResultKind,
				ProjectionRef:        projection.ProjectionRef,
				CreatedAt:            canonicalResultCreatedAt,
				PayloadSchemaVersion: "step-result-projection-v1",
				SanitizedPayload:     projection.Payload,
			},
			FinalizationFingerprintSHA256: finalizationFingerprint,
		},
	)
	if err != nil {
		if errors.Is(err, execution.ErrRunFinalizationConflict) {
			if run.Status != execution.DurableRunStatusCompleted {
				// The active-path callback and internal evidence have already
				// succeeded. Do not let the workflow turn this projection conflict
				// into a generic product failure.
				hasSuccessEvidence, evidenceErr := s.FinalizationSuccessEvidence(ctx, run)
				if evidenceErr != nil {
					return execution.DurableRun{}, evidenceErr
				}
				if hasSuccessEvidence {
					return execution.DurableRun{}, executionfailure.SanitizedError(
						"finalization_projection_conflict",
						err,
						true,
					)
				}
			}
			return execution.DurableRun{}, executionfailure.SanitizedError(
				"finalization_replay_conflict",
				err,
				true,
			)
		}
		return execution.DurableRun{}, err
	}
	return finalized.Run, nil
}

func (s *FinalizationService) ProjectWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	startedAt time.Time,
	completedAt time.Time,
	finalizedResponse map[string]any,
	replayEvidence ...*FinalizationProjectionEvidence,
) error {
	activityCompletedAt := CanonicalFinalizationTime(time.Now())
	projection := activityprojection.StepProjection{
		Attempt:            1,
		Tool:               "",
		Run:                run,
		Status:             "completed",
		StepID:             "finalization.write",
		StepKind:           "finalization",
		TaskQueue:          executioncontract.ActivityTaskQueueCore,
		WorkerID:           s.WorkerID,
		StartedAt:          startedAt,
		CompletedAt:        completedAt,
		AttemptCompletedAt: activityCompletedAt,
		UpdatedAt:          completedAt,
		AttemptUpdatedAt:   activityCompletedAt,
		ResultKind:         "final_answer_projection",
		ProjectionRef:      run.FinalResponseRef,
		Payload:            TemporalFinalizationResultPayload(finalizedResponse, input, run),
	}
	if len(replayEvidence) > 0 && replayEvidence[0] != nil {
		projection = replayEvidence[0].Apply(projection)
	}
	return s.ProjectStep(ctx, projection)
}

type FinalizationProjectionEvidence struct {
	ActivityAttempt          int
	ActivityID               string
	ActivityType             string
	Attempt                  int
	CanonicalCompletedAt     time.Time
	CanonicalResultCreatedAt time.Time
	CanonicalStartedAt       time.Time
	CanonicalUpdatedAt       time.Time
	CompletedAt              time.Time
	DurationMS               int64
	PreserveCanonicalTiming  bool
	ScheduledAt              time.Time
	ScheduleToStartMS        int64
	StartedAt                time.Time
	TaskQueue                string
	TemporalRunID            string
	UpdatedAt                time.Time
	WorkerID                 string
	WorkflowID               string
}

func (e *FinalizationProjectionEvidence) Apply(
	projection activityprojection.StepProjection,
) activityprojection.StepProjection {
	projection.ActivityAttempt = e.ActivityAttempt
	projection.ActivityID = e.ActivityID
	projection.ActivityType = e.ActivityType
	projection.Attempt = e.Attempt
	projection.AttemptCompletedAt = e.CompletedAt
	projection.DurationMS = e.DurationMS
	projection.PreserveAttempt = true
	projection.ScheduledAt = e.ScheduledAt
	projection.ScheduleToStartMS = e.ScheduleToStartMS
	projection.AttemptStartedAt = e.StartedAt
	projection.TemporalRunID = e.TemporalRunID
	projection.AttemptUpdatedAt = e.UpdatedAt
	if e.TaskQueue != "" {
		projection.TaskQueue = e.TaskQueue
	}
	projection.WorkerID = e.WorkerID
	projection.WorkflowID = e.WorkflowID
	return projection
}

func (s *FinalizationService) CompletedFinalizationProjectionEvidence(
	ctx context.Context,
	run execution.DurableRun,
) (*FinalizationProjectionEvidence, error) {
	steps, err := s.RunProjectionStore.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	var selectedStep *execution.RunStepProjection
	for _, step := range steps {
		if step.StepID == "finalization.write" && step.Status == "completed" {
			candidate := step
			selectedStep = &candidate
			break
		}
	}
	if selectedStep == nil {
		return nil, nil
	}
	activityAttempt := selectedStep.ActivityAttempt
	if activityAttempt <= 0 {
		return nil, nil
	}
	attempts, err := s.RunProjectionStore.ListStepAttempts(ctx, run.RequestID)
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
		return nil, executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("completed finalization attempt evidence is missing"),
			true,
		)
	}
	results, err := s.RunProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	var selectedResult *execution.StepResultProjection
	for index := range results {
		result := results[index]
		if result.StepID != execution.FinalizationStepID || result.Status != "completed" ||
			result.AttemptID != activityprojection.StepAttemptID(run.RequestID, execution.FinalizationStepID, selected.Attempt) {
			continue
		}
		candidate := result
		selectedResult = &candidate
		break
	}
	if selectedResult == nil || selectedResult.CreatedAt.IsZero() {
		return nil, executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("completed finalization result evidence is missing"),
			true,
		)
	}
	return &FinalizationProjectionEvidence{
		ActivityAttempt:          execution.ProjectionActivityAttempt(*selected),
		ActivityID:               selected.ActivityID,
		ActivityType:             selected.ActivityType,
		Attempt:                  selected.Attempt,
		CanonicalCompletedAt:     selectedStep.CompletedAt,
		CanonicalResultCreatedAt: selectedResult.CreatedAt,
		CanonicalStartedAt:       selectedStep.StartedAt,
		CanonicalUpdatedAt:       selectedStep.UpdatedAt,
		CompletedAt:              selected.CompletedAt,
		DurationMS:               selected.DurationMS,
		ScheduledAt:              selected.ScheduledAt,
		ScheduleToStartMS:        selected.ScheduleToStartMS,
		StartedAt:                selected.StartedAt,
		TaskQueue:                selected.TaskQueue,
		TemporalRunID:            selected.TemporalRunID,
		UpdatedAt:                selected.UpdatedAt,
		WorkerID:                 selected.WorkerID,
		WorkflowID:               selected.WorkflowID,
	}, nil
}

func (s *FinalizationService) RepairCompletedWorkflowFinalization(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
) (executioncontract.FinalizationOutput, error) {
	finalizedResponse, err := s.CompletedWorkflowFinalizedResponse(ctx, run)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	finalizationPayload := TemporalFinalizationResultPayload(finalizedResponse, input, run)
	finalizationFingerprint := strings.TrimSpace(
		execution.StringValue(finalizationPayload[execution.FinalizationFingerprintPayloadKey]),
	)
	timing, err := s.CompletedFinalizationTiming(
		ctx,
		run,
		input,
		finalizedResponse,
		finalizationFingerprint,
	)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	completedAt := timing.CompletedAt
	if err := s.ValidateCompletedWorkflowFinalizationStep(ctx, run, input, finalizedResponse); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	replayEvidence, err := s.CompletedFinalizationProjectionEvidence(ctx, run)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	if replayEvidence == nil {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("completed finalization step and attempt evidence is missing"),
			true,
		)
	}
	canonicalStartedAt := timing.StartedAt
	if canonicalStartedAt.IsZero() {
		canonicalStartedAt = CanonicalFinalizationTime(replayEvidence.StartedAt)
	}
	if canonicalStartedAt.IsZero() {
		canonicalStartedAt = CanonicalFinalizationTime(run.StartedAt)
	}
	if canonicalStartedAt.IsZero() {
		canonicalStartedAt = completedAt
	}
	agentResult := WorkflowFinalizationResultMap(input)
	if _, _, err := ValidateWorkflowResultSucceeded(agentResult); err != nil {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_replay_conflict",
			err,
			true,
		)
	}
	expectedTerminalReason := WorkflowTerminalReason(agentResult)
	if run.TerminalReason != expectedTerminalReason {
		return executioncontract.FinalizationOutput{}, executionfailure.SanitizedError(
			"finalization_replay_conflict",
			errors.New("completed run terminal identity differs from the workflow agent result"),
			true,
		)
	}
	canonicalRun, err := s.CommitWorkflowFinalizationStep(
		ctx,
		run,
		input,
		canonicalStartedAt,
		replayEvidence.CompletedAt,
		completedAt,
		finalizedResponse,
		replayEvidence,
	)
	if err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	if err := s.AppendWorkflowRunCompletedEvent(ctx, canonicalRun, completedAt); err != nil {
		return executioncontract.FinalizationOutput{}, err
	}
	campusdiagnostics.MarkCitations(ctx, s.RunProjectionStore, input.RequestID, campusSearchCitedRefs(finalizedResponse, input.WorkflowResult))
	return executioncontract.FinalizationOutput{
		CompletedAt:   completedAt,
		ProjectionRef: canonicalRun.FinalResponseRef,
		RequestID:     canonicalRun.RequestID,
		Status:        string(canonicalRun.Status),
	}, nil
}

func (s *FinalizationService) AppendWorkflowRunCompletedEvent(
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
	_, appendErr := s.RunProjectionStore.AppendRunEvent(ctx, expected)
	if appendErr == nil {
		return nil
	}
	if !errors.Is(appendErr, execution.ErrInvalidRunEvent) {
		return appendErr
	}
	// The event already exists: a replay must match its full identity, including time and visibility.
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
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
			activityprojection.EventPayloadEquivalent(existing.Payload, expected.Payload) {
			return nil
		}
		return executionfailure.SanitizedError(
			"finalization_replay_conflict",
			errors.New("run.completed event identity differs"),
			true,
		)
	}
	return appendErr
}

func (s *FinalizationService) ValidateCompletedWorkflowFinalizationStep(
	ctx context.Context,
	run execution.DurableRun,
	input executioncontract.FinalizationInput,
	finalizedResponse map[string]any,
) error {
	finalizationRef := activityprojection.ProjectionRef(run.RequestID, "finalization/write")
	if run.FinalResponseRef != finalizationRef || strings.TrimSpace(input.WorkflowResult.WorkflowResultRef) == "" {
		return executionfailure.SanitizedError(
			"finalization_replay_conflict",
			errors.New("completed run finalization identity differs"),
			true,
		)
	}
	results, err := s.RunProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return err
	}
	if len(finalizedResponse) == 0 {
		return executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			errors.New("completed run finalization response projection is missing"),
			true,
		)
	}
	expectedPayload := TemporalFinalizationResultPayload(finalizedResponse, input, run)
	completedResults := 0
	for _, result := range results {
		if result.StepID != "finalization.write" || result.Status != "completed" {
			continue
		}
		completedResults++
		activityAttempt, valid := execution.PositiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !valid || result.ResultID != activityprojection.StepResultID(run.RequestID, result.StepID, activityAttempt) ||
			result.AttemptID != activityprojection.StepAttemptID(run.RequestID, result.StepID, activityAttempt) ||
			result.RequestID != run.RequestID || result.ResultKind != "final_answer_projection" ||
			result.ProjectionRef != finalizationRef ||
			result.PayloadSchemaVersion != "step-result-projection-v1" {
			return executionfailure.SanitizedError(
				"finalization_replay_conflict",
				errors.New("completed finalization result identity differs"),
				true,
			)
		}
		expected := execution.CloneAnyMapFromValue(expectedPayload)
		expected["activity_attempt"] = activityAttempt
		if !execution.JSONMapsEquivalent(result.SanitizedPayload, expected) {
			return executionfailure.SanitizedError(
				"finalization_replay_conflict",
				errors.New("completed finalization result fingerprint differs"),
				true,
			)
		}
	}
	if completedResults != 1 {
		return executionfailure.SanitizedError(
			"finalization_replay_incomplete",
			fmt.Errorf("completed finalization result count is %d", completedResults),
			true,
		)
	}
	return nil
}

func (s *FinalizationService) CompletedWorkflowFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	events, err := s.RunProjectionStore.ListRunEvents(ctx, run.RequestID)
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		if event.EventID != run.RequestID+":finalization-completed-internal" {
			continue
		}
		// The response was validated before this internal event was appended.
		response := execution.CloneAnyMapFromValue(event.Payload["response"])
		if len(response) > 0 {
			return response, nil
		}
		break
	}
	return nil, executionfailure.SanitizedError(
		"finalization_replay_incomplete",
		errors.New("completed run finalization response projection is missing"),
		true,
	)
}

func ValidateWorkflowResultSucceeded(agentResult map[string]any) (string, string, error) {
	status := strings.TrimSpace(execution.StringValue(agentResult["status"]))
	if status != "completed" {
		return "", "agent_runtime_incomplete", fmt.Errorf("workflow result status is %q", status)
	}
	expectedFingerprint := execution.CloneAnyMapFromValue(agentResult["admitted_tool_contract_fingerprint"])
	if len(expectedFingerprint) > 0 {
		actualFingerprint := execution.CloneAnyMapFromValue(agentResult["tool_contract_fingerprint"])
		if len(actualFingerprint) == 0 ||
			!execution.ToolContractFingerprintMapsEqual(expectedFingerprint, actualFingerprint) {
			return "", "tool_contract_mismatch", errors.New(
				"persisted workflow runtime tool contract does not match admission",
			)
		}
	}
	return "", "", nil
}

func (s *FinalizationService) WorkflowFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	workflowResult map[string]any,
	additionalStageTiming ...StageTimingDuration,
) (map[string]any, error) {
	answerText, ok := workflowResult["final_output"].(string)
	if !ok || strings.TrimSpace(answerText) == "" {
		return nil, fmt.Errorf("workflow final_output is required")
	}
	citationClosure, err := s.WorkflowCitationClosureForFinalization(workflowResult, answerText)
	if err != nil {
		return nil, err
	}
	stageTiming, err := s.StageTimingForRun(
		ctx,
		run,
		execution.CloneAnyMapFromValue(workflowResult["stage_timing"]),
		additionalStageTiming...,
	)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if s.Logger != nil {
			s.Logger.WarnContext(ctx, "finalization timing unavailable", "request_id", run.RequestID)
		}
		stageTiming = nil
	}
	observability := map[string]any{
		"agent_runtime":   "agent_runtime",
		"model_name":      workflowResult["model_name"],
		"model_provider":  workflowResult["model_provider"],
		"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}
	result := map[string]any{
		"sources":         citationClosure.Sources,
		"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
	}
	modelUsage, err := WorkflowModelUsage(workflowResult)
	if err != nil {
		return nil, err
	}
	return ExecutionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		Status:        "completed",
		AnswerText:    citationClosure.AnswerText,
		Error:         nil,
		ModelUsage:    modelUsage,
		StageTiming:   stageTiming,
		Result:        result,
		Observability: observability,
	}), nil
}

func WorkflowModelUsage(workflowResult map[string]any) (ModelUsageWire, error) {
	usage := execution.CloneAnyMapFromValue(workflowResult["usage"])
	result := ModelUsageWire{
		InputTokens:       int64(IntFromAny(usage["input_tokens"])),
		CachedInputTokens: int64(IntFromAny(usage["cached_input_tokens"])),
		OutputTokens:      int64(IntFromAny(usage["output_tokens"])),
	}
	result.TotalTokens = result.InputTokens + result.OutputTokens
	if result.InputTokens < 0 || result.CachedInputTokens < 0 || result.OutputTokens < 0 ||
		result.CachedInputTokens > result.InputTokens {
		return ModelUsageWire{}, errors.New("agent model usage is invalid")
	}
	return result, nil
}

func WorkflowTerminalReason(workflowResult map[string]any) execution.DurableTerminalReason {
	return execution.DurableTerminalReasonAnswerCompleted
}

func WorkflowToolResultMaps(value any) []map[string]any {
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
