package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) RetrieveCampusDocsEvidenceActivity(
	ctx context.Context,
	input temporalruntime.RetrieveCampusDocsEvidenceActivityInput,
) (temporalruntime.CampusDocsRetrievalResult, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "campus_docs.retrieve", 10*time.Second)
	defer stopHeartbeat()
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, err
	}
	if !validSHA256Ref(input.AdmissionSnapshotSHA256) ||
		sha256JSONRef(input.AdmissionSnapshot) != input.AdmissionSnapshotSHA256 {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable",
			errors.New("Campus docs admission identity is invalid"),
			true,
		)
	}
	snapshot := input.AdmissionSnapshot
	if err := validateAdmissionSnapshot(snapshot); err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable", err, true,
		)
	}
	admission := snapshot.CampusDocsRetrieval
	wire, err := s.loadExecutionInput(ctx, run)
	if err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			executionInputFailureKind(err, "campus_docs_retrieval_unavailable"),
			err,
			executionInputFailureIsNonRetryable(err),
		)
	}
	query := campusDocsQueryForExecutionInput(wire, snapshot.AgentLimits.CurrentInputCharLimit)
	querySHA256 := sha256TextRef(query)
	if querySHA256 != admission.QuerySHA256 {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable",
			errors.New("Campus docs query differs from admission"),
			true,
		)
	}
	if s.campusDocsRetrievalErr != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable", s.campusDocsRetrievalErr, false,
		)
	}
	if s.campusDocsRetriever == nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable",
			errors.New("Campus docs retriever is not configured"),
			false,
		)
	}
	startedAt := time.Now().UTC()
	attempt := temporalActivityAttempt(ctx)
	projectionRef := temporalProjectionRef(run.RunID, "campus-docs/retrieval")
	if err := s.projectTemporalStep(ctx, s.withTemporalActivityEvidence(
		ctx,
		temporalStepProjection{
			Attempt:       attempt,
			Run:           run,
			Status:        "started",
			StepID:        "campus_docs.retrieve",
			StepKind:      "retrieval",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
			WorkerID:      s.config.TemporalWorkerIdentity,
			StartedAt:     startedAt,
			UpdatedAt:     startedAt,
			ProjectionRef: projectionRef,
			Payload: map[string]any{
				"admission_snapshot_sha256": input.AdmissionSnapshotSHA256,
				"collection":                admission.Index.Collection,
				"query_sha256":              querySHA256,
			},
		},
		attempt,
	)); err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, err
	}
	diagnostics, err := s.campusDocsRetriever.Retrieve(ctx, query, admission)
	if err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable", err, false,
		)
	}
	result := temporalruntime.CampusDocsRetrievalResult{
		Evidence: diagnostics.Evidence,
	}
	if err := validateCampusDocsRetrievalResult(result); err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, sanitizedTemporalApplicationError(
			"campus_docs_retrieval_unavailable", err, true,
		)
	}
	if err := s.projectCompletedCampusDocsRetrieval(
		ctx,
		run,
		input,
		result,
		diagnostics,
		startedAt,
		attempt,
		projectionRef,
	); err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, err
	}
	return result, nil
}

func (s *Server) projectCompletedCampusDocsRetrieval(
	ctx context.Context,
	run execution.DurableRun,
	input temporalruntime.RetrieveCampusDocsEvidenceActivityInput,
	result temporalruntime.CampusDocsRetrievalResult,
	diagnostics campusDocsRetrievalDiagnostics,
	startedAt time.Time,
	attempt int,
	projectionRef string,
) error {
	completedAt := time.Now().UTC()
	payload := map[string]any{
		"admission_snapshot_sha256": input.AdmissionSnapshotSHA256,
		"candidate_count":           diagnostics.CandidateCount,
		"collection":                input.AdmissionSnapshot.CampusDocsRetrieval.Index.Collection,
		"evidence_count":            len(result.Evidence),
		"query_sha256":              input.AdmissionSnapshot.CampusDocsRetrieval.QuerySHA256,
	}
	if stageTiming := diagnostics.StageTiming.projection(); len(stageTiming) > 0 {
		payload["stage_timing"] = stageTiming
	}
	return s.projectTemporalStep(ctx, s.withTemporalActivityEvidence(
		ctx,
		temporalStepProjection{
			Attempt:       attempt,
			Run:           run,
			Status:        "completed",
			StepID:        "campus_docs.retrieve",
			StepKind:      "retrieval",
			TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
			WorkerID:      s.config.TemporalWorkerIdentity,
			StartedAt:     startedAt,
			CompletedAt:   completedAt,
			UpdatedAt:     completedAt,
			ResultKind:    "campus_docs_retrieval",
			ProjectionRef: projectionRef,
			Payload:       payload,
		},
		attempt,
	))
}

func campusDocsRetrievalForPrimaryAgent(
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.CampusDocsRetrievalResult, error) {
	result := input.CampusDocsRetrieval
	if err := validateCampusDocsRetrievalResult(result); err != nil {
		return temporalruntime.CampusDocsRetrievalResult{}, err
	}
	return result, nil
}
