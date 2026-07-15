package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type knowledgeSearchEnvelope struct {
	Payload       knowledgeSearchPayload       `json:"payload"`
	AccessContext knowledgeSearchAccessContext `json:"access_context"`
}

type knowledgeSearchPayload struct {
	IncludeHistory bool   `json:"include_history"`
	QueryText      string `json:"query_text"`
	Target         string `json:"target"`
}

type knowledgeSearchAccessContext struct {
	ActivityAttempt int    `json:"activity_attempt"`
	RunID           string `json:"run_id"`
	TraceID         string `json:"trace_id"`
	InvocationID    string `json:"invocation_id"`
	SearchOrdinal   int    `json:"search_ordinal"`
}

func (s *Server) handleKnowledgeSearch(response http.ResponseWriter, request *http.Request) {
	const tool = "knowledge_search"
	if !s.toolReadModelAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid internal query auth.", false)
		s.metrics.RecordToolReadModel(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	envelope, err := decodeKnowledgeSearchEnvelope(body)
	if err != nil {
		s.writeKnowledgeSearchError(response, http.StatusBadRequest, "invalid_request", err, false)
		return
	}
	result, err := s.executeKnowledgeSearch(request.Context(), envelope)
	if err != nil {
		var conflict knowledgeSearchConflictError
		if errors.As(err, &conflict) {
			s.writeKnowledgeSearchError(response, http.StatusConflict, "run_context_conflict", err, false)
			return
		}
		s.writeKnowledgeSearchError(response, http.StatusServiceUnavailable, "knowledge_search_failed", err, true)
		return
	}
	setOutcome(response, result.Outcome)
	s.metrics.RecordToolReadModel(tool, result.Outcome, http.StatusOK)
	writeJSON(response, http.StatusOK, result)
}

func decodeKnowledgeSearchEnvelope(body json.RawMessage) (knowledgeSearchEnvelope, error) {
	var envelope knowledgeSearchEnvelope
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, fmt.Errorf("knowledge_search request is invalid: %w", err)
	}
	envelope.Payload.QueryText = strings.TrimSpace(envelope.Payload.QueryText)
	envelope.Payload.Target = strings.TrimSpace(envelope.Payload.Target)
	envelope.AccessContext.RunID = strings.TrimSpace(envelope.AccessContext.RunID)
	envelope.AccessContext.TraceID = strings.TrimSpace(envelope.AccessContext.TraceID)
	envelope.AccessContext.InvocationID = strings.TrimSpace(envelope.AccessContext.InvocationID)
	if envelope.Payload.QueryText == "" || envelope.AccessContext.RunID == "" ||
		envelope.AccessContext.TraceID == "" || envelope.AccessContext.InvocationID == "" ||
		envelope.Payload.Target == "" {
		return envelope, errors.New("query_text, target, run_id, trace_id, and invocation_id are required")
	}
	if envelope.AccessContext.SearchOrdinal <= 0 ||
		envelope.AccessContext.SearchOrdinal > config.MaxKnowledgeSearches {
		return envelope, fmt.Errorf(
			"search_ordinal must be between 1 and %d",
			config.MaxKnowledgeSearches,
		)
	}
	if envelope.AccessContext.ActivityAttempt <= 0 {
		return envelope, errors.New("activity_attempt must be positive")
	}
	return envelope, nil
}

type knowledgeSearchConflictError struct{ message string }

func (e knowledgeSearchConflictError) Error() string { return e.message }

func (s *Server) executeKnowledgeSearch(
	ctx context.Context,
	envelope knowledgeSearchEnvelope,
) (retrievalruntime.SearchResult, error) {
	if s.runProjectionStoreErr != nil {
		return retrievalruntime.SearchResult{}, s.runProjectionStoreErr
	}
	if s.runProjectionStore == nil {
		return retrievalruntime.SearchResult{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, envelope.AccessContext.RunID)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	if run.TraceID != envelope.AccessContext.TraceID {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: "knowledge search trace_id does not match run"}
	}
	if run.Status != execution.DurableRunStatusRunning {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: "knowledge search run is not running"}
	}
	if envelope.AccessContext.SearchOrdinal > s.primaryAgentRuntimeLimits().MaxKnowledgeSearches {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{
			message: "knowledge search ordinal exceeds the run search limit",
		}
	}
	target, err := runtimepolicy.ResolveQueryTarget(
		envelope.Payload.Target,
		s.config.QueryServingTargetsPath,
	)
	if err != nil {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: err.Error()}
	}
	access, err := knowledgeRetrievalAccessForRun(run)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	topK := target.RetrievalTopK
	if globalLimit := s.config.RAGTopKMax; globalLimit > 0 && topK > globalLimit {
		topK = globalLimit
	}
	searchRequest := retrievalruntime.SearchRequest{
		RunID:             run.RunID,
		RequestID:         run.RequestID,
		TraceID:           run.TraceID,
		InvocationID:      envelope.AccessContext.InvocationID,
		SearchOrdinal:     envelope.AccessContext.SearchOrdinal,
		QueryText:         envelope.Payload.QueryText,
		Target:            target.Target,
		ServingConfigPath: target.ServingConfigPath,
		IncludeHistory:    envelope.Payload.IncludeHistory,
		TopK:              topK,
		RetrievalAccess:   access,
	}
	if err := retrievalruntime.ValidateSearchRequest(searchRequest); err != nil {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: err.Error()}
	}
	if s.knowledgeSearchErr != nil {
		return retrievalruntime.SearchResult{}, s.knowledgeSearchErr
	}
	if s.knowledgeSearchExecutor == nil {
		return retrievalruntime.SearchResult{}, errors.New("knowledge search executor is not configured")
	}
	startedAt := time.Now().UTC()
	result, err := s.knowledgeSearchExecutor.Search(ctx, searchRequest)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	result.RunID = run.RunID
	result.InvocationID = searchRequest.InvocationID
	result.SearchOrdinal = searchRequest.SearchOrdinal
	result.RetrievalTarget = searchRequest.Target
	result.IncludeHistory = searchRequest.IncludeHistory
	result, err = retrievalruntime.FinalizeSearchResult(result)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	if err := s.projectKnowledgeSearchResult(
		ctx,
		run,
		searchRequest,
		result,
		startedAt,
		envelope.AccessContext.ActivityAttempt,
	); err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	return result, nil
}

func knowledgeRetrievalAccessForRun(run execution.DurableRun) (retrievalruntime.RetrievalAccess, error) {
	payload := cloneAnyMapFromMetadata(run.Metadata["execution_payload"])
	authorization := cloneAnyMapFromMetadata(nestedAny(payload, "context", "authorization"))
	filter := cloneAnyMapFromMetadata(authorization["retrieval_filter"])
	access := retrievalruntime.RetrievalAccess{
		EntitlementGroups:       stringSliceFromAny(filter["entitlement_groups"]),
		PolicyProjectionVersion: strings.TrimSpace(stringValue(filter["policy_projection_version"])),
		VisibilityLevel:         strings.TrimSpace(stringValue(filter["visibility_level"])),
		VisibilityScope:         strings.TrimSpace(stringValue(filter["visibility_scope"])),
	}
	if access.PolicyProjectionVersion == "" || access.VisibilityLevel == "" {
		return retrievalruntime.RetrievalAccess{}, errors.New("run retrieval access projection is required")
	}
	return access, nil
}

func (s *Server) projectKnowledgeSearchResult(
	ctx context.Context,
	run execution.DurableRun,
	request retrievalruntime.SearchRequest,
	result retrievalruntime.SearchResult,
	startedAt time.Time,
	activityAttempt int,
) error {
	completedAt := time.Now().UTC()
	return s.projectTemporalStep(ctx, temporalStepProjection{
		ActivityAttempt: activityAttempt,
		Attempt:         activityAttempt,
		Tool:            "knowledge_search",
		Run:             run,
		Status:          "completed",
		StepID:          "knowledge.search." + strconv.Itoa(request.SearchOrdinal),
		StepKind:        "retrieval",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		WorkerID:        s.config.TemporalWorkerIdentity,
		StartedAt:       startedAt,
		CompletedAt:     completedAt,
		UpdatedAt:       completedAt,
		ResultKind:      "knowledge_search_result",
		ProjectionRef:   result.SearchRef,
		Payload:         knowledgeSearchResultProjectionPayload(request, result, activityAttempt),
	})
}

func knowledgeSearchResultProjectionPayload(
	request retrievalruntime.SearchRequest,
	result retrievalruntime.SearchResult,
	activityAttempt int,
) map[string]any {
	evidence := make([]map[string]any, 0, len(result.Evidence))
	for _, item := range result.Evidence {
		evidence = append(evidence, map[string]any{
			"canonical_url":    item.CanonicalURL,
			"chunk_id":         item.ChunkID,
			"document_id":      item.DocumentID,
			"evidence_ref":     item.EvidenceRef,
			"fusion_score":     item.FusionScore,
			"rank":             item.Rank,
			"retrieval_target": item.RetrievalTarget,
			"snippet":          item.Snippet,
			"title":            item.Title,
			"version_id":       item.VersionID,
		})
	}
	return map[string]any{
		"activity_attempt": activityAttempt,
		"candidate_count":  result.CandidateCount,
		"discarded_count":  result.DiscardedCount,
		"evidence":         evidence,
		"include_history":  result.IncludeHistory,
		"invocation_id":    request.InvocationID,
		"outcome":          result.Outcome,
		"query_latency_ms": result.QueryLatencyMS,
		"query_sha256":     retrievalruntime.HashText(request.QueryText),
		"retrieval_target": result.RetrievalTarget,
		"retriever_modes":  append([]string{}, result.RetrieverModes...),
		"search_ordinal":   request.SearchOrdinal,
		"search_ref":       result.SearchRef,
	}
}

func (s *Server) writeKnowledgeSearchError(
	response http.ResponseWriter,
	status int,
	code string,
	cause error,
	retryable bool,
) {
	setOutcome(response, code)
	s.metrics.RecordToolReadModel("knowledge_search", code, status)
	writeError(response, status, code, cause.Error(), retryable)
}
