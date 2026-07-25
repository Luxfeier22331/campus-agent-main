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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type knowledgeSearchExecutor interface {
	HealthCheck(context.Context) error
	Search(context.Context, retrievalruntime.SearchRequest) (retrievalruntime.SearchResult, error)
}

type qdrantKnowledgeSearchExecutor struct {
	embeddingHTTPClient *http.Client
	embeddingKind       providerConfigKind
	configResolver      providerConfigResolver
	httpClient          *http.Client
	queryTargetsPath    string
	qdrantQueryAPIKey   string
	qdrantURL           string
	servingConfigRoot   string
	timeout             time.Duration
}

func newQdrantKnowledgeSearchExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (knowledgeSearchExecutor, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return nil, errors.New("QDRANT_URL is required for knowledge search")
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return nil, fmt.Errorf("QDRANT_URL must be a valid http(s) URL: %w", err)
	}
	if parsedQdrantURL.Scheme != "http" && parsedQdrantURL.Scheme != "https" {
		return nil, errors.New("QDRANT_URL must use http or https")
	}
	if parsedQdrantURL.Scheme == "http" && isDeployedEnvironment(cfg.DeploymentEnvironment) {
		return nil, errors.New("QDRANT_URL must use https for authenticated Qdrant data-plane")
	}
	if strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return nil, errors.New("QDRANT_QUERY_API_KEY is required for online Qdrant lookup")
	}
	qdrantTimeout := time.Duration(cfg.RAGQdrantTimeoutMS) * time.Millisecond
	if qdrantTimeout <= 0 {
		qdrantTimeout = 60 * time.Second
	}
	embeddingTimeout := time.Duration(cfg.RAGEmbeddingTimeoutMS) * time.Millisecond
	if embeddingTimeout <= 0 {
		embeddingTimeout = qdrantTimeout
	}
	httpClient, err := qdrantHTTPClient(parsedQdrantURL.Scheme, qdrantTimeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return nil, err
	}
	return qdrantKnowledgeSearchExecutor{
		embeddingHTTPClient: &http.Client{Timeout: embeddingTimeout},
		embeddingKind:       providerConfigKindEmbedding,
		configResolver:      configResolver,
		httpClient:          httpClient,
		queryTargetsPath:    strings.TrimSpace(cfg.QueryServingTargetsPath),
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:           qdrantURL,
		servingConfigRoot:   retrievalServingConfigRoot(),
		timeout:             qdrantTimeout,
	}, nil
}

func isDeployedEnvironment(environment string) bool {
	normalized := strings.ToLower(strings.TrimSpace(environment))
	return normalized == "staging" || normalized == "production"
}

func qdrantHTTPClient(scheme string, timeout time.Duration, caCertPath string) (*http.Client, error) {
	if scheme == "http" {
		return &http.Client{Timeout: timeout}, nil
	}
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

func (e qdrantKnowledgeSearchExecutor) Search(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
) (retrievalruntime.SearchResult, error) {
	if err := retrievalruntime.ValidateSearchRequest(request); err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	started := time.Now()
	profile, err := e.servingConfig(request)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	embedding, err := e.embedQueryWithProviderConfig(
		ctx,
		embeddingConfig,
		retrievalruntime.BuildDenseQueryText(request.QueryText, profile.EmbeddingQueryInstruction),
	)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	points, err := e.queryPointsWithProviderConfig(ctx, request, embedding, embeddingConfig)
	if err != nil {
		return retrievalruntime.SearchResult{}, err
	}
	evidence := make([]retrievalruntime.Evidence, 0, len(points))
	for index, point := range points {
		ref, ok, err := searchEvidenceFromQdrantPoint(point, request.Target, index+1)
		if err != nil {
			return retrievalruntime.SearchResult{}, err
		}
		if ok {
			evidence = append(evidence, ref)
		}
	}
	return retrievalruntime.FinalizeSearchResult(retrievalruntime.SearchResult{
		RunID:           request.RunID,
		InvocationID:    request.InvocationID,
		SearchOrdinal:   request.SearchOrdinal,
		RetrievalTarget: request.Target,
		IncludeHistory:  request.IncludeHistory,
		CandidateCount:  len(points),
		DiscardedCount:  len(points) - len(evidence),
		RetrieverModes:  []string{"dense", "sparse"},
		Evidence:        evidence,
		QueryLatencyMS:  time.Since(started).Milliseconds(),
	})
}

func (e qdrantKnowledgeSearchExecutor) HealthCheck(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, e.qdrantURL+"/collections", nil)
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
		return fmt.Errorf("qdrant collections status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantKnowledgeSearchExecutor) CheckEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	profiles, err := e.queryServingConfigs()
	if err != nil {
		return err
	}
	if len(profiles) == 0 {
		return errors.New("no query-serving configs are available for knowledge search compatibility check")
	}
	for _, profile := range profiles {
		if err := e.validateAliasCompatibility(ctx, profile, snapshot); err != nil {
			return fmt.Errorf("%s/%s: %w", profile.Corpus, profile.Collection, err)
		}
	}
	return nil
}

func (e qdrantKnowledgeSearchExecutor) queryServingConfigs() ([]retrievalruntime.ServingConfig, error) {
	root := servingConfigScanRoot(e.servingConfigRoot)
	targets, err := runtimepolicy.QueryServingTargets(e.queryTargetsPath)
	if err != nil {
		return nil, err
	}
	profiles := make([]retrievalruntime.ServingConfig, 0, len(targets))
	for _, target := range targets {
		profile, err := retrievalruntime.LoadServingConfigPath(root, target.ServingConfigPath)
		if err != nil {
			return nil, err
		}
		if profile.Collection != target.Collection {
			return nil, fmt.Errorf(
				"query target %s collection = %q, serving config collection = %q",
				target.Target,
				target.Collection,
				profile.Collection,
			)
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func servingConfigScanRoot(configRoot string) string {
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

func (e qdrantKnowledgeSearchExecutor) embedQuery(ctx context.Context, queryText string) ([]float64, error) {
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.embedQueryWithProviderConfig(ctx, embeddingConfig, queryText)
}

func (e qdrantKnowledgeSearchExecutor) embedQueryWithProviderConfig(
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

func (e qdrantKnowledgeSearchExecutor) resolveEmbeddingProviderConfig(
	ctx context.Context,
) (providerConfigSnapshot, error) {
	kind := e.embeddingKind
	if kind == "" {
		kind = providerConfigKindEmbedding
	}
	if e.configResolver != nil {
		return e.configResolver.ResolveActiveProviderConfig(ctx, kind)
	}
	return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
}

func (e qdrantKnowledgeSearchExecutor) queryPoints(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
	embedding []float64,
) ([]qdrantPoint, error) {
	profile, err := e.servingConfig(request)
	if err != nil {
		return nil, err
	}
	if err := validateKnowledgeSearchQueryShape(request, profile, embedding); err != nil {
		return nil, err
	}
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.queryPointsWithProfileAndProviderConfig(ctx, request, profile, embedding, embeddingConfig)
}

func (e qdrantKnowledgeSearchExecutor) queryPointsWithProviderConfig(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
) ([]qdrantPoint, error) {
	profile, err := e.servingConfig(request)
	if err != nil {
		return nil, err
	}
	return e.queryPointsWithProfileAndProviderConfig(ctx, request, profile, embedding, embeddingConfig)
}

func (e qdrantKnowledgeSearchExecutor) queryPointsWithProfileAndProviderConfig(
	ctx context.Context,
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
) ([]qdrantPoint, error) {
	if err := validateEmbeddingProfileCompatibility(profile, embeddingConfig, len(embedding)); err != nil {
		return nil, err
	}
	bodyPayload, err := retrievalruntime.BuildHybridQueryBody(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		IncludeHistory:  search.IncludeHistory,
		ServingConfig:   profile,
		QueryText:       search.QueryText,
		RetrievalAccess: search.RetrievalAccess,
		TopK:            search.TopK,
	})
	if err != nil {
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

func validateKnowledgeSearchQueryShape(
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
) error {
	_, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		IncludeHistory:  search.IncludeHistory,
		ServingConfig:   profile,
		QueryText:       search.QueryText,
		RetrievalAccess: search.RetrievalAccess,
		TopK:            search.TopK,
	})
	return err
}

func (e qdrantKnowledgeSearchExecutor) validateAliasCompatibility(
	ctx context.Context,
	profile retrievalruntime.ServingConfig,
	embeddingConfig providerConfigSnapshot,
) error {
	if err := validateEmbeddingProfileCompatibility(profile, embeddingConfig, profile.EmbeddingDimensions); err != nil {
		return err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(profile.QdrantAliasName)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	response, err := e.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant alias status %d", response.StatusCode)
	}
	var payload map[string]any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return fmt.Errorf("parse qdrant alias response: %w", err)
	}
	params := cloneAnyMapFromMetadata(nestedAny(payload, "result", "config", "params"))
	vectors := cloneAnyMapFromMetadata(params["vectors"])
	dense := cloneAnyMapFromMetadata(vectors[profile.DenseVectorName])
	if len(dense) == 0 {
		return fmt.Errorf("dense vector %s is missing", profile.DenseVectorName)
	}
	size, ok := positiveIntValue(dense["size"])
	if !ok {
		return fmt.Errorf("dense vector %s size is missing", profile.DenseVectorName)
	}
	if embeddingConfig.Dimensions <= 0 {
		return errors.New("embedding provider dimensions are required")
	}
	if size != embeddingConfig.Dimensions {
		return fmt.Errorf(
			"dense vector %s size = %d, provider dimensions = %d",
			profile.DenseVectorName,
			size,
			embeddingConfig.Dimensions,
		)
	}
	sparseVectors := cloneAnyMapFromMetadata(params["sparse_vectors"])
	if _, ok := sparseVectors[profile.SparseVectorName]; !ok {
		return fmt.Errorf("sparse vector %s is missing", profile.SparseVectorName)
	}
	return nil
}

type qdrantPoint struct {
	ID      any            `json:"id"`
	Payload map[string]any `json:"payload"`
	Score   float64        `json:"score"`
}

func searchEvidenceFromQdrantPoint(
	point qdrantPoint,
	target string,
	rank int,
) (retrievalruntime.Evidence, bool, error) {
	payload := point.Payload
	if len(payload) == 0 {
		return retrievalruntime.Evidence{}, false, nil
	}
	metadata := qdrantPointMetadata(point)
	excerpt := qdrantPointText(point)
	if excerpt == "" {
		return retrievalruntime.Evidence{}, false, nil
	}
	excerpt, err := retrievalruntime.TruncateUTF8Bytes(excerpt, retrievalruntime.MaxEvidenceSnippet)
	if err != nil {
		return retrievalruntime.Evidence{}, false, fmt.Errorf("qdrant evidence snippet: %w", err)
	}
	sourceID := firstNonEmptyText(
		metadata["canonical_source_id"],
		metadata["source_doc_id"],
		metadata["document_id"],
		point.ID,
	)
	chunkID := firstNonEmptyText(metadata["chunk_id"], point.ID)
	spanRef := firstNonEmptyText(metadata["span_ref"], metadata["structural_ref"])
	if spanRef == "" {
		spanRef = "span://" + sourceID + "/" + chunkID
	}
	canonicalURL := firstNonEmptyText(metadata["canonical_url"], metadata["source_uri"])
	title := firstNonEmptyText(
		metadata["source_title"],
		metadata["title"],
		metadata["document_title"],
		metadata["canonical_source_title"],
	)
	if sourceID == "" || chunkID == "" || canonicalURL == "" || title == "" {
		return retrievalruntime.Evidence{}, false, nil
	}
	return retrievalruntime.Evidence{
		EvidenceRef:     "evidence://sha256/" + retrievalruntime.HashText(sourceID+"\x00"+chunkID+"\x00"+spanRef),
		RetrievalTarget: strings.TrimSpace(target),
		DocumentID:      sourceID,
		ChunkID:         chunkID,
		CanonicalURL:    canonicalURL,
		Snippet:         excerpt,
		Title:           title,
		VersionID:       firstNonEmptyText(metadata["version_id"]),
		Rank:            rank,
		FusionScore:     point.Score,
	}, true, nil
}

func qdrantPointMetadata(point qdrantPoint) map[string]any {
	payload := point.Payload
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
	return metadata
}

func qdrantPointText(point qdrantPoint) string {
	metadata := qdrantPointMetadata(point)
	return firstNonEmptyText(
		metadata["text"],
		metadata["display_text"],
		metadata["snippet"],
		point.Payload["text"],
		point.Payload["display_text"],
		point.Payload["snippet"],
	)
}

func (e qdrantKnowledgeSearchExecutor) servingConfig(search retrievalruntime.SearchRequest) (retrievalruntime.ServingConfig, error) {
	target, err := runtimepolicy.ResolveQueryTarget(search.Target, e.queryTargetsPath)
	if err != nil {
		return retrievalruntime.ServingConfig{}, err
	}
	if target.ServingConfigPath != search.ServingConfigPath {
		return retrievalruntime.ServingConfig{}, fmt.Errorf(
			"query target %s serving config path does not match the registry",
			search.Target,
		)
	}
	profile, err := retrievalruntime.LoadServingConfigPath(e.servingConfigRoot, search.ServingConfigPath)
	if err != nil {
		return retrievalruntime.ServingConfig{}, err
	}
	if profile.Collection != target.Collection {
		return retrievalruntime.ServingConfig{}, fmt.Errorf(
			"query target %s collection = %q, serving config collection = %q",
			search.Target,
			target.Collection,
			profile.Collection,
		)
	}
	return profile, nil
}

func validateEmbeddingProfileCompatibility(
	profile retrievalruntime.ServingConfig,
	embeddingConfig providerConfigSnapshot,
	embeddingDimensions int,
) error {
	if profile.EmbeddingProvider != strings.TrimSpace(embeddingConfig.Provider) {
		return fmt.Errorf(
			"embedding provider = %q, serving profile provider = %q",
			embeddingConfig.Provider,
			profile.EmbeddingProvider,
		)
	}
	if profile.EmbeddingModel != strings.TrimSpace(embeddingConfig.Model) {
		return fmt.Errorf(
			"embedding model = %q, serving profile model = %q",
			embeddingConfig.Model,
			profile.EmbeddingModel,
		)
	}
	if embeddingConfig.Dimensions != profile.EmbeddingDimensions {
		return fmt.Errorf(
			"embedding provider dimensions = %d, serving profile dimensions = %d",
			embeddingConfig.Dimensions,
			profile.EmbeddingDimensions,
		)
	}
	if embeddingDimensions != profile.EmbeddingDimensions {
		return fmt.Errorf(
			"embedding dimensions = %d, serving profile dimensions = %d",
			embeddingDimensions,
			profile.EmbeddingDimensions,
		)
	}
	if profile.EmbeddingVectorName != profile.DenseVectorName {
		return fmt.Errorf(
			"embedding vector name = %q, Qdrant dense vector name = %q",
			profile.EmbeddingVectorName,
			profile.DenseVectorName,
		)
	}
	return nil
}

func retrievalServingConfigRoot() string {
	return ""
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
