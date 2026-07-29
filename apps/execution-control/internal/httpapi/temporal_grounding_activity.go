package httpapi

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) PrepareGroundingContextActivity(
	ctx context.Context,
	input temporalruntime.PrepareGroundingContextActivityInput,
) (temporalruntime.PrepareGroundingContextActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "grounding.prepare", 10*time.Second)
	defer stopHeartbeat()
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{}, err
	}
	if !validSHA256Ref(input.AdmissionSnapshotSHA256) ||
		sha256JSONRef(input.AdmissionSnapshot) != input.AdmissionSnapshotSHA256 {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError(
				"retrieval_unavailable",
				errors.New("grounding admission identity is invalid"),
				true,
			)
	}
	snapshot := input.AdmissionSnapshot
	if err := validateAdmissionSnapshot(snapshot); err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, true)
	}
	if snapshot.GroundingPlan.Mode == "none" {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError(
				"retrieval_unavailable",
				errors.New("direct grounding plan must not execute retrieval"),
				true,
			)
	}
	wire, err := s.loadExecutionInput(ctx, run)
	if err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError(
				executionInputFailureKind(err, "retrieval_unavailable"),
				err,
				executionInputFailureIsNonRetryable(err),
			)
	}
	query := groundingQueryForExecutionInput(wire, snapshot.AgentLimits.CurrentInputCharLimit)
	querySHA256 := sha256TextRef(query)
	if querySHA256 != snapshot.GroundingPlan.QuerySHA256 {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError(
				"retrieval_unavailable",
				errors.New("grounding query differs from the frozen plan"),
				true,
			)
	}
	contextRef := groundingContextRef(run.RunID)
	var existing groundingContext
	if err := s.getProtectedJSON(
		ctx,
		run,
		contextRef,
		protectedPayloadKindGroundingContext,
		&existing,
	); err == nil {
		if validationErr := validateGroundingContextForRun(
			existing,
			run.RunID,
			input.AdmissionSnapshotSHA256,
		); validationErr != nil {
			return temporalruntime.PrepareGroundingContextActivityOutput{},
				sanitizedTemporalApplicationError(
					"retrieval_unavailable",
					validationErr,
					true,
				)
		}
		if existing.PlanSHA256 != snapshot.GroundingPlanSHA256 ||
			existing.QuerySHA256 != snapshot.GroundingPlan.QuerySHA256 {
			return temporalruntime.PrepareGroundingContextActivityOutput{},
				sanitizedTemporalApplicationError(
					"retrieval_unavailable",
					errors.New("grounding context differs from the frozen plan"),
					true,
				)
		}
		output := groundingActivityOutput(run.RunID, contextRef, existing)
		projected, projectionErr := s.completedGroundingProjectionExists(
			ctx,
			run.RunID,
			contextRef,
			input.AdmissionSnapshotSHA256,
			querySHA256,
			input.AdmissionSnapshot.GroundingPlanSHA256,
			output,
		)
		if projectionErr != nil {
			return temporalruntime.PrepareGroundingContextActivityOutput{}, projectionErr
		}
		if !projected {
			startedAt := time.Now().UTC()
			if projectionErr := s.projectCompletedGroundingContext(
				ctx,
				run,
				input,
				querySHA256,
				contextRef,
				output,
				startedAt,
				temporalActivityAttempt(ctx),
				nil,
			); projectionErr != nil {
				return temporalruntime.PrepareGroundingContextActivityOutput{}, projectionErr
			}
		}
		return output, nil
	} else if !errors.Is(err, execution.ErrProtectedPayloadNotFound) {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, true)
	}
	if s.groundingErr != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", s.groundingErr, false)
	}
	if s.groundingExecutor == nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError(
				"retrieval_unavailable",
				errors.New("grounding executor is not configured"),
				false,
			)
	}
	payload := executionPayloadMap(wire)
	access, err := knowledgeRetrievalAccessForPayload(payload)
	if err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, true)
	}
	startedAt := time.Now().UTC()
	attempt := temporalActivityAttempt(ctx)
	if err := s.projectTemporalStep(ctx, s.withTemporalActivityEvidence(
		ctx,
		temporalStepProjection{
			Attempt:       attempt,
			Run:           run,
			Status:        "started",
			StepID:        "grounding.prepare",
			StepKind:      "retrieval",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
			WorkerID:      s.config.TemporalWorkerIdentity,
			StartedAt:     startedAt,
			UpdatedAt:     startedAt,
			ProjectionRef: contextRef,
			Payload: map[string]any{
				"admission_snapshot_sha256": input.AdmissionSnapshotSHA256,
				"query_sha256":              querySHA256,
			},
		},
		attempt,
	)); err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{}, err
	}
	preparation, err := s.groundingExecutor.Prepare(ctx, query, access, snapshot)
	if err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, false)
	}
	evidence := preparation.Evidence
	tokenCount := 0
	for _, item := range evidence {
		tokenCount += item.TokenCount
	}
	coveredScopes := coveredGroundingScopes(snapshot.GroundingPlan.SelectedScopes, evidence)
	status := groundingStatus(
		snapshot.GroundingPlan.Mode,
		snapshot.GroundingPlan.SelectedScopes,
		coveredScopes,
	)
	grounding := groundingContext{
		SchemaVersion:   groundingContextSchemaVersion,
		RunID:           run.RunID,
		AdmissionSHA256: input.AdmissionSnapshotSHA256,
		CoveredScopes:   coveredScopes,
		Mode:            snapshot.GroundingPlan.Mode,
		PlanSHA256:      snapshot.GroundingPlanSHA256,
		QuerySHA256:     querySHA256,
		PreparedAt:      time.Now().UTC().Truncate(time.Microsecond),
		SelectedScopes:  append([]string{}, snapshot.GroundingPlan.SelectedScopes...),
		Status:          status,
		TokenCount:      tokenCount,
		Evidence:        evidence,
	}
	grounding.ModelContextChars = groundingModelContextCharacterCount(grounding.Status, grounding.Evidence)
	if err := validateGroundingContext(grounding); err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, true)
	}
	if err := s.putProtectedJSON(
		ctx,
		run,
		contextRef,
		protectedPayloadKindGroundingContext,
		grounding,
	); err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{},
			sanitizedTemporalApplicationError("retrieval_unavailable", err, false)
	}
	output := groundingActivityOutput(run.RunID, contextRef, grounding)
	if err := s.projectCompletedGroundingContext(
		ctx,
		run,
		input,
		querySHA256,
		contextRef,
		output,
		startedAt,
		attempt,
		&preparation,
	); err != nil {
		return temporalruntime.PrepareGroundingContextActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) projectCompletedGroundingContext(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.PrepareGroundingContextActivityInput,
	querySHA256 string,
	contextRef string,
	output temporalruntime.PrepareGroundingContextActivityOutput,
	startedAt time.Time,
	attempt int,
	diagnostics *groundingPreparation,
) error {
	completedAt := time.Now().UTC()
	payload := map[string]any{
		"admission_snapshot_sha256": input.AdmissionSnapshotSHA256,
		"covered_scopes":            append([]string{}, output.CoveredScopes...),
		"evidence_count":            output.EvidenceCount,
		"grounding_context_ref":     output.GroundingContextRef,
		"grounding_mode":            output.Mode,
		"grounding_plan_sha256":     input.AdmissionSnapshot.GroundingPlanSHA256,
		"model_context_chars":       output.ModelContextChars,
		"payload_sha256":            output.PayloadSHA256,
		"query_sha256":              querySHA256,
		"selected_scopes":           append([]string{}, output.SelectedScopes...),
		"status":                    output.Status,
		"token_count":               output.TokenCount,
	}
	if diagnostics != nil {
		payload["candidate_count"] = diagnostics.CandidateCount
		if stageTiming := diagnostics.StageTiming.projection(); len(stageTiming) > 0 {
			payload["stage_timing"] = stageTiming
		}
	}
	return s.projectTemporalStep(ctx, s.withTemporalActivityEvidence(
		ctx,
		temporalStepProjection{
			Attempt:       attempt,
			Run:           run,
			Status:        "completed",
			StepID:        "grounding.prepare",
			StepKind:      "retrieval",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
			WorkerID:      s.config.TemporalWorkerIdentity,
			StartedAt:     startedAt,
			CompletedAt:   completedAt,
			UpdatedAt:     completedAt,
			ResultKind:    "grounding_context",
			ProjectionRef: contextRef,
			Payload:       payload,
		},
		attempt,
	))
}

func (s *Server) completedGroundingProjectionExists(
	ctx context.Context,
	runID string,
	contextRef string,
	admissionSHA256 string,
	querySHA256 string,
	groundingPlanSHA256 string,
	output temporalruntime.PrepareGroundingContextActivityOutput,
) (bool, error) {
	results, err := s.runProjectionStore.ListStepResults(ctx, runID)
	if err != nil {
		return false, err
	}
	for _, result := range results {
		payload := result.SanitizedPayload
		if result.StepID == "grounding.prepare" &&
			result.Status == "completed" &&
			result.ResultKind == "grounding_context" &&
			result.ProjectionRef == contextRef &&
			stringValue(payload["admission_snapshot_sha256"]) == admissionSHA256 &&
			stringValue(payload["query_sha256"]) == querySHA256 &&
			stringValue(payload["grounding_context_ref"]) == contextRef &&
			stringValue(payload["grounding_mode"]) == output.Mode &&
			stringValue(payload["grounding_plan_sha256"]) == groundingPlanSHA256 &&
			equalStringSlices(stringSliceFromAny(payload["selected_scopes"]), output.SelectedScopes) &&
			equalStringSlices(stringSliceFromAny(payload["covered_scopes"]), output.CoveredScopes) &&
			stringValue(payload["payload_sha256"]) == output.PayloadSHA256 &&
			stringValue(payload["status"]) == output.Status &&
			intFromAny(payload["evidence_count"]) == output.EvidenceCount &&
			intFromAny(payload["token_count"]) == output.TokenCount &&
			intFromAny(payload["model_context_chars"]) == output.ModelContextChars {
			return true, nil
		}
	}
	return false, nil
}

func groundingActivityOutput(
	runID string,
	contextRef string,
	grounding groundingContext,
) temporalruntime.PrepareGroundingContextActivityOutput {
	return temporalruntime.PrepareGroundingContextActivityOutput{
		CoveredScopes:       append([]string{}, grounding.CoveredScopes...),
		EvidenceCount:       len(grounding.Evidence),
		GroundingContextRef: contextRef,
		Mode:                grounding.Mode,
		ModelContextChars:   grounding.ModelContextChars,
		PayloadSHA256:       sha256JSONRef(grounding),
		RunID:               runID,
		SelectedScopes:      append([]string{}, grounding.SelectedScopes...),
		Status:              grounding.Status,
		TokenCount:          grounding.TokenCount,
	}
}

func validateGroundingContextForRun(
	value groundingContext,
	runID string,
	admissionSHA256 string,
) error {
	if err := validateGroundingContext(value); err != nil {
		return err
	}
	if value.RunID != strings.TrimSpace(runID) ||
		value.AdmissionSHA256 != admissionSHA256 {
		return errors.New("grounding context does not match the run")
	}
	return nil
}

func (s *Server) loadGroundingContextForPrimaryAgent(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (groundingContext, string, error) {
	contextRef := strings.TrimSpace(input.GroundingContextRef)
	if contextRef != groundingContextRef(run.RunID) {
		return groundingContext{}, "", errors.New("grounding context ref does not match the run")
	}
	var grounding groundingContext
	err := s.getProtectedJSON(
		ctx,
		run,
		contextRef,
		protectedPayloadKindGroundingContext,
		&grounding,
	)
	if errors.Is(err, execution.ErrProtectedPayloadNotFound) &&
		input.AdmissionSnapshot.GroundingPlan.Mode == "none" {
		grounding = groundingContext{
			AdmissionSHA256: sha256JSONRef(input.AdmissionSnapshot),
			CoveredScopes:   []string{},
			Evidence:        []groundingEvidence{},
			Mode:            "none",
			PlanSHA256:      input.AdmissionSnapshot.GroundingPlanSHA256,
			PreparedAt:      time.Now().UTC().Truncate(time.Microsecond),
			QuerySHA256:     input.AdmissionSnapshot.GroundingPlan.QuerySHA256,
			RunID:           run.RunID,
			SchemaVersion:   groundingContextSchemaVersion,
			SelectedScopes:  []string{},
			Status:          "not_required",
			TokenCount:      0,
		}
		grounding.ModelContextChars = groundingModelContextCharacterCount(
			grounding.Status,
			grounding.Evidence,
		)
		if err := validateGroundingContext(grounding); err != nil {
			return groundingContext{}, "", err
		}
		if err := s.putProtectedJSON(
			ctx,
			run,
			contextRef,
			protectedPayloadKindGroundingContext,
			grounding,
		); err != nil {
			return groundingContext{}, "", err
		}
	} else if err != nil {
		return groundingContext{}, "", err
	}
	if err := validateGroundingContextForRun(
		grounding,
		run.RunID,
		sha256JSONRef(input.AdmissionSnapshot),
	); err != nil {
		return groundingContext{}, "", err
	}
	if grounding.PlanSHA256 != input.AdmissionSnapshot.GroundingPlanSHA256 ||
		grounding.QuerySHA256 != input.AdmissionSnapshot.GroundingPlan.QuerySHA256 ||
		grounding.Mode != input.AdmissionSnapshot.GroundingPlan.Mode ||
		!equalStringSlices(grounding.SelectedScopes, input.AdmissionSnapshot.GroundingPlan.SelectedScopes) {
		return groundingContext{}, "", errors.New("grounding context does not match the frozen plan")
	}
	return grounding, sha256JSONRef(grounding), nil
}

func groundingContextRef(runID string) string {
	return "projection://runs/" + url.PathEscape(strings.TrimSpace(runID)) + "/grounding/context"
}
