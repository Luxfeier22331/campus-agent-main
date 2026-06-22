package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/rageval"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

type ragFirstStageEvalExecutor struct {
	qdrant qdrantRAGLookupExecutor
}

func NewRAGFirstStageEvalExecutor(cfg config.Config) (rageval.FirstStageExecutor, error) {
	configResolver, err := newProviderConfigResolver(cfg)
	if err != nil {
		return nil, err
	}
	lookupExecutor, err := newQdrantRAGLookupExecutor(cfg, configResolver)
	if err != nil {
		return nil, err
	}
	qdrant, ok := lookupExecutor.(qdrantRAGLookupExecutor)
	if !ok {
		return nil, fmt.Errorf("RAG eval requires qdrant lookup executor, got %T", lookupExecutor)
	}
	return ragFirstStageEvalExecutor{qdrant: qdrant}, nil
}

func (e ragFirstStageEvalExecutor) Lookup(
	ctx context.Context,
	request rageval.LookupRequest,
) (rageval.LookupResult, error) {
	started := time.Now()
	plan, err := ragEvalPlanFromLookupRequest(request)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	baseProfile, err := e.qdrant.runtimeProfile(plan)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	embeddingConfig, err := e.qdrant.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	if err := e.qdrant.validateAliasReleaseMetadata(ctx, baseProfile, embeddingConfig); err != nil {
		return rageval.LookupResult{}, err
	}
	profile := overrideRAGEvalRuntimeProfile(baseProfile, request)
	embedding, err := e.qdrant.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		retrievalruntime.BuildDenseQueryText(plan.QueryText, profile.EmbeddingQueryInstruction),
	)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	if err := validateRAGLookupQueryShape(plan, profile, embedding); err != nil {
		return rageval.LookupResult{}, err
	}

	denseBody, err := ragEvalDenseQueryBody(plan, profile, embedding, request.DensePrefetchLimit)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	densePoints, err := e.qdrant.queryPointsWithBody(ctx, profile, denseBody)
	if err != nil {
		return rageval.LookupResult{}, fmt.Errorf("dense prefetch query: %w", err)
	}
	sparseBody, err := ragEvalSparseQueryBody(plan, profile, request.SparsePrefetchLimit)
	if err != nil {
		return rageval.LookupResult{}, err
	}
	sparsePoints, err := e.qdrant.queryPointsWithBody(ctx, profile, sparseBody)
	if err != nil {
		return rageval.LookupResult{}, fmt.Errorf("sparse prefetch query: %w", err)
	}
	hybridBody, err := retrievalruntime.BuildHybridQueryBody(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		Mode:            plan.QueryMode,
		Profile:         profile,
		QueryText:       plan.QueryText,
		RetrievalAccess: retrievalAccessFromRAGPlan(plan),
		TopK:            plan.TopK,
	})
	if err != nil {
		return rageval.LookupResult{}, err
	}
	finalPoints, err := e.qdrant.queryPointsWithBody(ctx, profile, hybridBody)
	if err != nil {
		return rageval.LookupResult{}, fmt.Errorf("rrf final query: %w", err)
	}
	finalStage := rageval.StageRRFFinal
	if profile.RerankerEnabledByDefault {
		finalPoints, err = e.qdrant.rerankPoints(ctx, plan.QueryText, finalPoints)
		if err != nil {
			return rageval.LookupResult{}, fmt.Errorf("rerank final query: %w", err)
		}
		finalStage = rageval.StageRerankFinal
	}
	prefetchSources := make([]rageval.CandidateSource, 0, len(densePoints)+len(sparsePoints))
	prefetchSources = append(
		prefetchSources,
		ragEvalCandidateSourcesFromPoints(densePoints, rageval.StageDensePrefetch)...,
	)
	prefetchSources = append(
		prefetchSources,
		ragEvalCandidateSourcesFromPoints(sparsePoints, rageval.StageSparsePrefetch)...,
	)
	return rageval.LookupResult{
		LatencyMS:       ragEvalElapsedMillis(started),
		PrefetchSources: prefetchSources,
		FinalSources:    ragEvalCandidateSourcesFromPoints(finalPoints, finalStage),
	}, nil
}

func (e qdrantRAGLookupExecutor) queryPointsWithBody(
	ctx context.Context,
	profile retrievalruntime.RuntimeProfile,
	bodyPayload map[string]any,
) ([]qdrantPoint, error) {
	if e.httpClient == nil {
		return nil, errors.New("qdrant HTTP client is not configured")
	}
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(profile.QdrantAliasName) + "/points/query"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant query status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant query response: %w", err)
	}
	return payload.Result.Points, nil
}

func ragEvalDenseQueryBody(
	plan ragruntime.PlanProjection,
	profile retrievalruntime.RuntimeProfile,
	embedding []float64,
	limit int,
) (map[string]any, error) {
	filter, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		Mode:            plan.QueryMode,
		Profile:         profile,
		QueryText:       plan.QueryText,
		RetrievalAccess: retrievalAccessFromRAGPlan(plan),
		TopK:            plan.TopK,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"filter":       filter,
		"limit":        ragEvalMaxInt(plan.TopK, limit),
		"query":        embedding,
		"using":        profile.DenseVectorName,
		"with_payload": true,
		"with_vector":  false,
	}, nil
}

func ragEvalSparseQueryBody(
	plan ragruntime.PlanProjection,
	profile retrievalruntime.RuntimeProfile,
	limit int,
) (map[string]any, error) {
	filter, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		Mode:            plan.QueryMode,
		Profile:         profile,
		QueryText:       plan.QueryText,
		RetrievalAccess: retrievalAccessFromRAGPlan(plan),
		TopK:            plan.TopK,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"filter": filter,
		"limit":  ragEvalMaxInt(plan.TopK, limit),
		"query": map[string]any{
			"model": "qdrant/bm25",
			"options": map[string]any{
				"ascii_folding": false,
				"language":      "none",
				"lowercase":     true,
				"tokenizer":     "multilingual",
			},
			"text": plan.QueryText,
		},
		"using":        profile.SparseVectorName,
		"with_payload": true,
		"with_vector":  false,
	}, nil
}

func overrideRAGEvalRuntimeProfile(
	profile retrievalruntime.RuntimeProfile,
	request rageval.LookupRequest,
) retrievalruntime.RuntimeProfile {
	profile.DensePrefetchLimit = request.DensePrefetchLimit
	profile.RetrievalTopK = request.RetrievalTopK
	profile.RRFK = request.RRFK
	profile.RRFDenseWeight = request.RRFDenseWeight
	profile.RRFSparseWeight = request.RRFSparseWeight
	profile.SparsePrefetchLimit = request.SparsePrefetchLimit
	profile.RerankerEnabledByDefault = request.RerankerEnabled
	return profile
}

func ragEvalPlanFromLookupRequest(request rageval.LookupRequest) (ragruntime.PlanProjection, error) {
	caseID := strings.TrimSpace(request.CaseID)
	corpus := strings.TrimSpace(request.Corpus)
	collection := strings.TrimSpace(request.Collection)
	queryText := strings.TrimSpace(request.QueryText)
	if caseID == "" || corpus == "" || collection == "" || queryText == "" {
		return ragruntime.PlanProjection{}, errors.New("case_id, corpus, collection and query_text are required")
	}
	hash := sha256.Sum256([]byte(caseID + "\n" + corpus + "\n" + collection + "\n" + queryText))
	return ragruntime.PlanProjection{
		Collection:      collection,
		CollectionAlias: collection,
		Corpus:          corpus,
		PayloadSHA256:   hex.EncodeToString(hash[:]),
		PlanID:          "rag-eval-plan-" + safeRAGEvalID(caseID),
		QueryMode:       "current",
		QueryText:       queryText,
		RetrievalAccess: ragruntime.RetrievalAccessProjection{
			EntitlementGroups:       append([]string{}, request.RetrievalAccess.EntitlementGroups...),
			PolicyProjectionVersion: request.RetrievalAccess.PolicyProjectionVersion,
			VisibilityLevel:         request.RetrievalAccess.VisibilityLevel,
			VisibilityScope:         request.RetrievalAccess.VisibilityScope,
		},
		RequestID:        "rag-eval-request-" + safeRAGEvalID(caseID),
		RunID:            "rag-eval-run-" + safeRAGEvalID(caseID),
		RuntimeProfileID: corpus + "/" + collection,
		StepID:           "rag-eval-step-" + safeRAGEvalID(caseID),
		TopK:             request.RetrievalTopK,
	}, nil
}

func ragEvalCandidateSourcesFromPoints(
	points []qdrantPoint,
	stage string,
) []rageval.CandidateSource {
	sources := make([]rageval.CandidateSource, 0, len(points))
	for index, point := range points {
		ref, ok := evidenceRefFromQdrantPoint(point)
		if !ok {
			continue
		}
		docID := firstNonEmptyText(ref.DocumentID, ref.SourceID)
		if docID == "" {
			continue
		}
		sources = append(sources, rageval.CandidateSource{
			Rank:      index + 1,
			Stage:     stage,
			DocID:     docID,
			VersionID: optionalSourcePointer(ref.VersionID),
			ChunkID:   optionalSourcePointer(ref.ChunkID),
			Score:     scorePointer(ref.Score),
		})
	}
	return sources
}

func optionalSourcePointer(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func scorePointer(value float64) *float64 {
	return &value
}

func ragEvalElapsedMillis(started time.Time) int64 {
	elapsed := time.Since(started).Milliseconds()
	if elapsed <= 0 {
		return 1
	}
	return elapsed
}

func ragEvalMaxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func safeRAGEvalID(value string) string {
	normalized := strings.Builder{}
	for _, ch := range value {
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') {
			normalized.WriteRune(ch)
			continue
		}
		normalized.WriteByte('-')
	}
	return strings.Trim(normalized.String(), "-")
}
