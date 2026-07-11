package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type knowledgeVersionResolver interface {
	ResolveKnowledgeVersion(
		context.Context,
		retrievalruntime.SearchRequest,
	) (retrievalruntime.ResolvedVersion, error)
}

type knowledgeSearchEnvelope struct {
	Payload       knowledgeSearchPayload       `json:"payload"`
	AccessContext knowledgeSearchAccessContext `json:"access_context"`
}

type knowledgeSearchPayload struct {
	QueryText string `json:"query_text"`
}

type knowledgeSearchAccessContext struct {
	RunID          string                        `json:"run_id"`
	TraceID        string                        `json:"trace_id"`
	InvocationID   string                        `json:"invocation_id"`
	KnowledgeScope string                        `json:"knowledge_scope"`
	VersionQuery   retrievalruntime.VersionQuery `json:"version_query"`
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
	envelope.AccessContext.RunID = strings.TrimSpace(envelope.AccessContext.RunID)
	envelope.AccessContext.TraceID = strings.TrimSpace(envelope.AccessContext.TraceID)
	envelope.AccessContext.InvocationID = strings.TrimSpace(envelope.AccessContext.InvocationID)
	envelope.AccessContext.KnowledgeScope = strings.TrimSpace(envelope.AccessContext.KnowledgeScope)
	if envelope.Payload.QueryText == "" || envelope.AccessContext.RunID == "" ||
		envelope.AccessContext.TraceID == "" || envelope.AccessContext.InvocationID == "" ||
		envelope.AccessContext.KnowledgeScope == "" {
		return envelope, errors.New("query_text, run_id, trace_id, invocation_id, and knowledge_scope are required")
	}
	if strings.TrimSpace(envelope.AccessContext.VersionQuery.Mode) == "" {
		envelope.AccessContext.VersionQuery.Mode = "current"
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
	mode := strings.TrimSpace(envelope.AccessContext.VersionQuery.Mode)
	admission, err := runtimepolicy.AdmitKnowledgeScope(runtimepolicy.KnowledgeScopeAdmissionRequest{
		QueryMode: mode,
		Scope:     envelope.AccessContext.KnowledgeScope,
	}, s.config.QueryServingScopesPath)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	if !admission.Allowed {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: "knowledge scope or version mode is not admitted"}
	}
	access, err := knowledgeRetrievalAccessForRun(run)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	topK := s.config.RAGTopKMax
	if topK <= 0 || topK > retrievalruntime.MaxSearchEvidence {
		topK = 8
	}
	searchRequest := retrievalruntime.SearchRequest{
		RunID:           run.RunID,
		RequestID:       run.RequestID,
		TraceID:         run.TraceID,
		InvocationID:    envelope.AccessContext.InvocationID,
		QueryText:       envelope.Payload.QueryText,
		Scope:           admission.Scope,
		Corpus:          admission.InternalScope.Corpus,
		Collection:      admission.InternalScope.Collection,
		TopK:            topK,
		VersionQuery:    envelope.AccessContext.VersionQuery,
		RetrievalAccess: access,
	}
	if err := retrievalruntime.ValidateSearchRequest(searchRequest); err != nil {
		return retrievalruntime.SearchResult{}, knowledgeSearchConflictError{message: err.Error()}
	}
	resolvedVersion, err := s.resolveKnowledgeSearchVersion(ctx, searchRequest)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	searchRequest.ResolvedVersion = resolvedVersion
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
	result.ResolvedScope = searchRequest.Scope
	result.ResolvedVersion = resolvedVersion
	result, err = retrievalruntime.FinalizeSearchResult(result)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	if err := s.projectKnowledgeSearchResult(ctx, run, searchRequest, result, startedAt); err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	return result, nil
}

func (s *Server) resolveKnowledgeSearchVersion(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
) (retrievalruntime.ResolvedVersion, error) {
	if strings.TrimSpace(request.VersionQuery.Mode) == "current" {
		return retrievalruntime.ResolveSearchVersion(request, nil)
	}
	if s.knowledgeVersionResolver == nil {
		return retrievalruntime.ResolvedVersion{}, errors.New("knowledge version resolver is not configured")
	}
	return s.knowledgeVersionResolver.ResolveKnowledgeVersion(ctx, request)
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
) error {
	latest, err := s.runProjectionStore.GetRun(ctx, run.RunID)
	if err != nil {
		return err
	}
	metadata := cloneTemporalMetadata(latest.Metadata)
	searches := cloneAnyMapFromMetadata(metadata["knowledge_searches"])
	searches[request.InvocationID] = map[string]any{
		"query_sha256": retrievalruntime.HashText(request.QueryText),
		"result":       knowledgeSearchResultMetadata(result),
	}
	metadata["knowledge_searches"] = searches
	if err := s.runProjectionStore.ReplaceRunMetadata(ctx, run.RunID, metadata); err != nil {
		return err
	}
	completedAt := time.Now().UTC()
	evidenceRefs := make([]string, 0, len(result.Evidence))
	for _, evidence := range result.Evidence {
		evidenceRefs = append(evidenceRefs, evidence.EvidenceRef)
	}
	stepSuffix := retrievalruntime.HashText(request.InvocationID)
	if len(stepSuffix) > 12 {
		stepSuffix = stepSuffix[:12]
	}
	return s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          "knowledge_search",
		Run:           run,
		Status:        "completed",
		StepID:        "knowledge.search." + stepSuffix,
		StepKind:      "retrieval",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "knowledge_search_result",
		ProjectionRef: result.SearchRef,
		Payload: map[string]any{
			"evidence_refs":    evidenceRefs,
			"invocation_id":    request.InvocationID,
			"outcome":          result.Outcome,
			"query_latency_ms": result.QueryLatencyMS,
			"resolved_scope":   result.ResolvedScope,
			"resolved_version": result.ResolvedVersion,
		},
	})
}

func knowledgeSearchResultMetadata(result retrievalruntime.SearchResult) map[string]any {
	evidence := make([]map[string]any, 0, len(result.Evidence))
	for _, item := range result.Evidence {
		evidence = append(evidence, map[string]any{
			"canonical_url": item.CanonicalURL,
			"evidence_ref":  item.EvidenceRef,
			"snippet":       item.Snippet,
			"title":         item.Title,
			"version_id":    item.VersionID,
		})
	}
	return map[string]any{
		"evidence":         evidence,
		"outcome":          result.Outcome,
		"resolved_scope":   result.ResolvedScope,
		"resolved_version": result.ResolvedVersion,
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
