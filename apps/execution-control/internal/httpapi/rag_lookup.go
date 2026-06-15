package httpapi

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
)

type ragLookupExecutor interface {
	HealthCheck(context.Context) error
	Lookup(context.Context, ragruntime.PlanProjection) (ragruntime.RetrievalLookupResult, error)
}

type qdrantRAGLookupExecutor struct {
	embeddingHTTPClient *http.Client
	embeddingProvider   string
	embeddingRole       providerConfigRole
	configResolver      providerConfigResolver
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
	runtimeProfileRoot  string
	timeout             time.Duration
}

func newQdrantRAGLookupExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (ragLookupExecutor, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return nil, errors.New("QDRANT_URL is required for Go RAG lookup")
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return nil, fmt.Errorf("QDRANT_URL must be a valid http(s) URL: %w", err)
	}
	if parsedQdrantURL.Scheme != "https" {
		return nil, errors.New("QDRANT_URL must use https for authenticated Qdrant data-plane")
	}
	if strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return nil, errors.New("QDRANT_QUERY_API_KEY is required for online Qdrant lookup")
	}
	timeout := time.Duration(cfg.QdrantTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	httpClient, err := qdrantTLSHTTPClient(timeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return nil, err
	}
	return qdrantRAGLookupExecutor{
		embeddingHTTPClient: &http.Client{Timeout: timeout},
		embeddingRole:       providerConfigRoleRAGQueryEmbedding,
		embeddingProvider:   strings.TrimSpace(cfg.EmbeddingProvider),
		configResolver:      configResolver,
		httpClient:          httpClient,
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:           qdrantURL,
		runtimeProfileRoot:  retrievalRuntimeProfileRoot(),
		timeout:             timeout,
	}, nil
}

func qdrantTLSHTTPClient(timeout time.Duration, caCertPath string) (*http.Client, error) {
	trimmedCAPath := strings.TrimSpace(caCertPath)
	if trimmedCAPath == "" {
		return nil, errors.New("QDRANT_TLS_CA_CERT_PATH is required for HTTPS Qdrant data-plane")
	}
	caBytes, err := os.ReadFile(trimmedCAPath)
	if err != nil {
		return nil, fmt.Errorf("read QDRANT_TLS_CA_CERT_PATH: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if ok := rootCAs.AppendCertsFromPEM(caBytes); !ok {
		return nil, errors.New("QDRANT_TLS_CA_CERT_PATH must contain at least one PEM certificate")
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
				RootCAs:    rootCAs,
			},
		},
	}, nil
}

func (e qdrantRAGLookupExecutor) Lookup(
	ctx context.Context,
	plan ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	if err := ragruntime.ValidatePlanProjection(plan); err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	started := time.Now()
	profile, err := e.runtimeProfile(plan)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	embedding, err := e.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		retrievalruntime.BuildDenseQueryText(plan.QueryText, profile.EmbeddingQueryInstruction),
	)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	points, err := e.queryPointsWithProviderConfig(ctx, plan, embedding, embeddingConfig)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	candidates := make([]ragruntime.EvidenceRef, 0, len(points))
	for _, point := range points {
		ref, ok := evidenceRefFromQdrantPoint(point)
		if ok {
			candidates = append(candidates, ref)
		}
	}
	result := ragruntime.RetrievalLookupResult{
		CandidateCount: len(candidates),
		Candidates:     candidates,
		LookupRef:      temporalProjectionRef(plan.RunID, "retrieval/indexed-lookup"),
		QueryLatencyMS: time.Since(started).Milliseconds(),
		Request: ragruntime.RetrievalLookupRequest{
			CollectionAlias: plan.CollectionAlias,
			QueryMode:       plan.QueryMode,
			QueryText:       plan.QueryText,
			RunID:           plan.RunID,
			TopK:            plan.TopK,
		},
		SchemaVersion: "retrieval_lookup_result_v1",
	}
	hash, err := ragruntime.HashProjection(result)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	result.PayloadSHA256 = hash
	return result, nil
}

func (e qdrantRAGLookupExecutor) HealthCheck(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, e.qdrantURL+"/readyz", nil)
	if err != nil {
		return err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	response, err := e.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant readyz status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantRAGLookupExecutor) CheckEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	profiles, err := e.queryServingRuntimeProfiles()
	if err != nil {
		return err
	}
	if len(profiles) == 0 {
		return errors.New("no query-serving runtime profiles are available for RAG compatibility check")
	}
	for _, profile := range profiles {
		if err := e.validateAliasReleaseMetadata(ctx, profile, snapshot); err != nil {
			return fmt.Errorf("%s/%s: %w", profile.Corpus, profile.Collection, err)
		}
	}
	return nil
}

func (e qdrantRAGLookupExecutor) queryServingRuntimeProfiles() ([]retrievalruntime.RuntimeProfile, error) {
	root := runtimeProfileScanRoot(e.runtimeProfileRoot)
	matches, err := filepath.Glob(filepath.Join(root, "*", "*", "runtime-profile.json"))
	if err != nil {
		return nil, fmt.Errorf("list runtime profiles: %w", err)
	}
	profiles := make([]retrievalruntime.RuntimeProfile, 0, len(matches))
	for _, path := range matches {
		collectionDir := filepath.Dir(path)
		corpusDir := filepath.Dir(collectionDir)
		corpus := filepath.Base(corpusDir)
		collection := filepath.Base(collectionDir)
		profile, err := retrievalruntime.LoadRuntimeProfile(root, corpus, collection)
		if err != nil {
			continue
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func runtimeProfileScanRoot(configRoot string) string {
	root := strings.TrimSpace(configRoot)
	if root != "" {
		return root
	}
	for _, candidate := range []string{
		filepath.Join("configs", "ingestion"),
		filepath.Join("..", "..", "configs", "ingestion"),
		filepath.Join("..", "..", "..", "configs", "ingestion"),
		filepath.Join("..", "..", "..", "..", "configs", "ingestion"),
	} {
		if stat, err := os.Stat(candidate); err == nil && stat.IsDir() {
			return candidate
		}
	}
	return filepath.Join("configs", "ingestion")
}

func (e qdrantRAGLookupExecutor) embedQuery(ctx context.Context, queryText string) ([]float64, error) {
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.embedQueryWithProviderConfig(ctx, embeddingConfig, queryText)
}

func (e qdrantRAGLookupExecutor) embedQueryWithProviderConfig(
	ctx context.Context,
	embeddingConfig providerConfigSnapshot,
	queryText string,
) ([]float64, error) {
	if e.embeddingHTTPClient == nil {
		return nil, errors.New("embedding HTTP client is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"model":      embeddingConfig.Model,
		"input":      strings.TrimSpace(queryText),
		"dimensions": embeddingConfig.Dimensions,
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(embeddingConfig.BaseURL, "/")+"/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+embeddingConfig.APIKey)
	request.Header.Set("content-type", "application/json")
	response, err := e.embeddingHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("embedding provider status %d", response.StatusCode)
	}
	var payload struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse embedding response: %w", err)
	}
	if len(payload.Data) == 0 || len(payload.Data[0].Embedding) == 0 {
		return nil, errors.New("embedding response did not contain embedding")
	}
	if embeddingConfig.Dimensions > 0 && len(payload.Data[0].Embedding) != embeddingConfig.Dimensions {
		return nil, fmt.Errorf(
			"embedding dimension = %d, want %d",
			len(payload.Data[0].Embedding),
			embeddingConfig.Dimensions,
		)
	}
	return payload.Data[0].Embedding, nil
}

func (e qdrantRAGLookupExecutor) resolveEmbeddingProviderConfig(
	ctx context.Context,
) (providerConfigSnapshot, error) {
	role := e.embeddingRole
	if role == "" {
		role = providerConfigRoleRAGQueryEmbedding
	}
	if e.configResolver != nil {
		return e.configResolver.ResolveActiveProviderConfig(ctx, role)
	}
	return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
}

func (e qdrantRAGLookupExecutor) queryPoints(
	ctx context.Context,
	plan ragruntime.PlanProjection,
	embedding []float64,
) ([]qdrantPoint, error) {
	profile, err := e.runtimeProfile(plan)
	if err != nil {
		return nil, err
	}
	if err := validateRAGLookupQueryShape(plan, profile, embedding); err != nil {
		return nil, err
	}
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.queryPointsWithProfileAndProviderConfig(ctx, plan, profile, embedding, embeddingConfig)
}

func (e qdrantRAGLookupExecutor) queryPointsWithProviderConfig(
	ctx context.Context,
	plan ragruntime.PlanProjection,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
) ([]qdrantPoint, error) {
	profile, err := e.runtimeProfile(plan)
	if err != nil {
		return nil, err
	}
	return e.queryPointsWithProfileAndProviderConfig(ctx, plan, profile, embedding, embeddingConfig)
}

func (e qdrantRAGLookupExecutor) queryPointsWithProfileAndProviderConfig(
	ctx context.Context,
	plan ragruntime.PlanProjection,
	profile retrievalruntime.RuntimeProfile,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
) ([]qdrantPoint, error) {
	bodyPayload, err := retrievalruntime.BuildHybridQueryBody(retrievalruntime.QueryRequest{
		CompareToVersionID: resolvedQueryCompareToVersionID(plan),
		DenseEmbedding:     embedding,
		Mode:               plan.QueryMode,
		Profile:            profile,
		QueryText:          plan.QueryText,
		TopK:               plan.TopK,
		VersionID:          resolvedQueryVersionID(plan),
	})
	if err != nil {
		return nil, err
	}
	if err := e.validateAliasReleaseMetadata(ctx, profile, embeddingConfig); err != nil {
		return nil, err
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

func validateRAGLookupQueryShape(
	plan ragruntime.PlanProjection,
	profile retrievalruntime.RuntimeProfile,
	embedding []float64,
) error {
	_, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		CompareToVersionID: resolvedQueryCompareToVersionID(plan),
		DenseEmbedding:     embedding,
		Mode:               plan.QueryMode,
		Profile:            profile,
		QueryText:          plan.QueryText,
		TopK:               plan.TopK,
		VersionID:          resolvedQueryVersionID(plan),
	})
	return err
}

func (e qdrantRAGLookupExecutor) validateAliasReleaseMetadata(
	ctx context.Context,
	profile retrievalruntime.RuntimeProfile,
	embeddingConfig providerConfigSnapshot,
) error {
	metadata, err := e.readQdrantCollectionMetadata(ctx, profile.QdrantAliasName)
	if err != nil {
		return err
	}
	if len(metadata) > 0 {
		return retrievalruntime.ValidateReleaseMetadata(retrievalruntime.ReleaseGuardRequest{
			EmbeddingDimensions: embeddingConfig.Dimensions,
			EmbeddingModel:      embeddingConfig.Model,
			EmbeddingProvider:   firstNonEmptyText(embeddingConfig.Provider, e.embeddingProvider),
			Metadata:            metadata,
			Profile:             profile,
		})
	}
	samples, err := e.readQdrantReleaseMetadataSamples(ctx, profile.QdrantAliasName)
	if err != nil {
		return err
	}
	return retrievalruntime.ValidateReleaseMetadataSamples(retrievalruntime.ReleaseGuardSamplesRequest{
		EmbeddingDimensions: embeddingConfig.Dimensions,
		EmbeddingModel:      embeddingConfig.Model,
		EmbeddingProvider:   firstNonEmptyText(embeddingConfig.Provider, e.embeddingProvider),
		MetadataSamples:     samples,
		Profile:             profile,
	})
}

func (e qdrantRAGLookupExecutor) readQdrantCollectionMetadata(
	ctx context.Context,
	collectionName string,
) (map[string]any, error) {
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(collectionName)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
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
		return nil, fmt.Errorf("qdrant collection metadata status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Metadata map[string]any `json:"metadata"`
			Payload  map[string]any `json:"payload"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant collection metadata response: %w", err)
	}
	if len(payload.Result.Metadata) > 0 {
		return payload.Result.Metadata, nil
	}
	return payload.Result.Payload, nil
}

func (e qdrantRAGLookupExecutor) readQdrantReleaseMetadataSamples(
	ctx context.Context,
	collectionName string,
) ([]map[string]any, error) {
	body, err := json.Marshal(map[string]any{
		"limit":        16,
		"with_payload": true,
		"with_vector":  false,
	})
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(collectionName) + "/points/scroll"
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
		return nil, fmt.Errorf("qdrant release metadata scroll status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant release metadata scroll response: %w", err)
	}
	samples := make([]map[string]any, 0, len(payload.Result.Points))
	for _, point := range payload.Result.Points {
		if len(point.Payload) > 0 {
			samples = append(samples, point.Payload)
		}
	}
	return samples, nil
}

type qdrantPoint struct {
	ID      any            `json:"id"`
	Payload map[string]any `json:"payload"`
	Score   float64        `json:"score"`
}

func evidenceRefFromQdrantPoint(point qdrantPoint) (ragruntime.EvidenceRef, bool) {
	payload := point.Payload
	if len(payload) == 0 {
		return ragruntime.EvidenceRef{}, false
	}
	metadata := payload
	if nodeContent := strings.TrimSpace(optionalStringFromAny(payload["_node_content"])); nodeContent != "" {
		var node struct {
			ID       string         `json:"id_"`
			Text     string         `json:"text"`
			Metadata map[string]any `json:"metadata"`
		}
		if err := json.Unmarshal([]byte(nodeContent), &node); err == nil && len(node.Metadata) > 0 {
			metadata = node.Metadata
			if strings.TrimSpace(optionalStringFromAny(metadata["text"])) == "" && strings.TrimSpace(node.Text) != "" {
				metadata = cloneAnyMapFromMetadata(metadata)
				metadata["text"] = node.Text
			}
			if strings.TrimSpace(optionalStringFromAny(metadata["chunk_id"])) == "" && strings.TrimSpace(node.ID) != "" {
				metadata = cloneAnyMapFromMetadata(metadata)
				metadata["chunk_id"] = node.ID
			}
		}
	}
	excerpt := firstNonEmptyText(
		metadata["text"],
		metadata["display_text"],
		metadata["snippet"],
		payload["text"],
		payload["display_text"],
		payload["snippet"],
	)
	if excerpt == "" {
		return ragruntime.EvidenceRef{}, false
	}
	if len([]byte(excerpt)) > 1200 {
		excerpt = string([]rune(excerpt)[:minInt(len([]rune(excerpt)), 600)])
	}
	sourceID := firstNonEmptyText(
		metadata["canonical_source_id"],
		metadata["source_doc_id"],
		metadata["document_id"],
		point.ID,
	)
	documentID := firstNonEmptyText(metadata["document_id"], metadata["source_doc_id"], metadata["canonical_source_id"])
	chunkID := firstNonEmptyText(metadata["chunk_id"], point.ID)
	spanRef := firstNonEmptyText(metadata["span_ref"], metadata["structural_ref"])
	if spanRef == "" {
		spanRef = "span://" + sourceID + "/" + chunkID
	}
	sourceRef := firstNonEmptyText(metadata["source_ref"], metadata["canonical_url"], metadata["source_uri"])
	if sourceRef == "" {
		sourceRef = "source://" + sourceID
	}
	return ragruntime.EvidenceRef{
		Anchor:          firstNonEmptyText(metadata["anchor"], metadata["section_anchor"]),
		CanonicalURL:    firstNonEmptyText(metadata["canonical_url"], metadata["source_uri"]),
		ChunkID:         chunkID,
		DocumentID:      documentID,
		Excerpt:         excerpt,
		IsAnswerBearing: optionalBoolFromAny(metadata["is_answer_bearing"], metadata["answer_bearing"]),
		IsCurrent:       optionalBoolFromAny(metadata["is_current"]),
		LatestURL:       firstNonEmptyText(metadata["latest_url"], metadata["canonical_url"], metadata["source_uri"]),
		RevisionTrack:   firstNonEmptyText(metadata["revision_track"]),
		RootUnitID:      firstNonEmptyText(metadata["root_unit_id"], metadata["parent_unit_id"]),
		Score:           point.Score,
		SourceChannel:   firstNonEmptyText(metadata["source_channel"]),
		SourceID:        sourceID,
		SourceRef:       sourceRef,
		SourceUnitKey:   firstNonEmptyText(metadata["source_unit_key"]),
		SourceUnitKind:  firstNonEmptyText(metadata["source_unit_kind"]),
		SpanRef:         spanRef,
		Title: firstNonEmptyText(
			metadata["source_title"],
			metadata["title"],
			metadata["document_title"],
			metadata["canonical_source_title"],
		),
		VersionID: firstNonEmptyText(metadata["version_id"]),
	}, sourceID != "" && chunkID != ""
}

func (s *Server) ragIndexedLookup(
	ctx context.Context,
	run execution.DurableRun,
	plan ragruntime.PlanProjection,
) (ragruntime.RetrievalLookupResult, error) {
	if s.ragLookupErr != nil {
		return ragruntime.RetrievalLookupResult{}, s.ragLookupErr
	}
	if s.ragLookupExecutor == nil {
		return ragruntime.RetrievalLookupResult{}, errors.New("rag lookup executor is not configured")
	}
	result, err := s.ragLookupExecutor.Lookup(ctx, plan)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	if result.CandidateCount <= 0 || len(result.Candidates) == 0 {
		return ragruntime.RetrievalLookupResult{}, errors.New("retrieval returned no answer-bearing evidence")
	}
	if result.Request.RunID != run.RunID {
		return ragruntime.RetrievalLookupResult{}, errors.New("retrieval lookup run_id drift")
	}
	return result, nil
}

func (e qdrantRAGLookupExecutor) runtimeProfile(plan ragruntime.PlanProjection) (retrievalruntime.RuntimeProfile, error) {
	return retrievalruntime.LoadRuntimeProfile(e.runtimeProfileRoot, plan.Corpus, plan.Collection)
}

func retrievalRuntimeProfileRoot() string {
	return ""
}

func resolvedQueryVersionID(plan ragruntime.PlanProjection) string {
	if plan.ResolvedVersionQuery == nil {
		return ""
	}
	return strings.TrimSpace(plan.ResolvedVersionQuery.VersionID)
}

func resolvedQueryCompareToVersionID(plan ragruntime.PlanProjection) string {
	if plan.ResolvedVersionQuery == nil {
		return ""
	}
	return strings.TrimSpace(plan.ResolvedVersionQuery.CompareToVersionID)
}

func firstNonEmptyText(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(optionalStringFromAny(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func optionalStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}

func optionalBoolFromAny(values ...any) bool {
	for _, value := range values {
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			normalized := strings.TrimSpace(strings.ToLower(typed))
			if normalized == "true" || normalized == "1" || normalized == "yes" {
				return true
			}
			if normalized == "false" || normalized == "0" || normalized == "no" {
				return false
			}
		}
	}
	return false
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
