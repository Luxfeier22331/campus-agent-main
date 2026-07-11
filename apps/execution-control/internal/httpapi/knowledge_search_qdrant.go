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
	embeddingRole       providerConfigRole
	configResolver      providerConfigResolver
	httpClient          *http.Client
	queryScopesPath     string
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
	if parsedQdrantURL.Scheme == "http" && strings.TrimSpace(cfg.RuntimeMode) != "local" {
		return nil, errors.New("QDRANT_URL must use https for authenticated Qdrant data-plane")
	}
	if strings.TrimSpace(cfg.QdrantQueryAPIKey) == "" {
		return nil, errors.New("QDRANT_QUERY_API_KEY is required for online Qdrant lookup")
	}
	qdrantTimeout := time.Duration(cfg.RAGQdrantTimeoutMS) * time.Millisecond
	if qdrantTimeout <= 0 {
		qdrantTimeout = time.Duration(cfg.QdrantTimeoutSeconds * float64(time.Second))
	}
	if qdrantTimeout <= 0 {
		qdrantTimeout = 10 * time.Second
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
		embeddingRole:       providerConfigRoleRAGQueryEmbedding,
		configResolver:      configResolver,
		httpClient:          httpClient,
		queryScopesPath:     strings.TrimSpace(cfg.QueryServingScopesPath),
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:           qdrantURL,
		servingConfigRoot:   retrievalServingConfigRoot(),
		timeout:             qdrantTimeout,
	}, nil
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
	for _, point := range points {
		ref, ok := searchEvidenceFromQdrantPoint(point)
		if ok {
			evidence = append(evidence, ref)
		}
	}
	return retrievalruntime.FinalizeSearchResult(retrievalruntime.SearchResult{
		RunID:           request.RunID,
		InvocationID:    request.InvocationID,
		ResolvedScope:   request.Scope,
		ResolvedVersion: request.ResolvedVersion,
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
		if err := e.validateAliasReleaseMetadata(ctx, profile, snapshot); err != nil {
			return fmt.Errorf("%s/%s: %w", profile.Corpus, profile.Collection, err)
		}
	}
	return nil
}

func (e qdrantKnowledgeSearchExecutor) queryServingConfigs() ([]retrievalruntime.ServingConfig, error) {
	root := servingConfigScanRoot(e.servingConfigRoot)
	scopes, err := runtimepolicy.InternalScopesForAllowedKnowledgeScopes(e.queryScopesPath)
	if err != nil {
		return nil, err
	}
	profiles := make([]retrievalruntime.ServingConfig, 0, len(scopes))
	for _, scope := range scopes {
		profile, err := retrievalruntime.LoadServingConfig(root, scope.Corpus, scope.Collection)
		if err != nil {
			return nil, err
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
	role := e.embeddingRole
	if role == "" {
		role = providerConfigRoleRAGQueryEmbedding
	}
	if e.configResolver != nil {
		return e.configResolver.ResolveActiveProviderConfig(ctx, role)
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
	bodyPayload, err := retrievalruntime.BuildHybridQueryBody(retrievalruntime.QueryRequest{
		CompareToVersionID: search.ResolvedVersion.CompareToVersionID,
		DenseEmbedding:     embedding,
		Mode:               search.ResolvedVersion.Mode,
		ServingConfig:      profile,
		QueryText:          search.QueryText,
		RetrievalAccess:    search.RetrievalAccess,
		TopK:               search.TopK,
		VersionID:          search.ResolvedVersion.VersionID,
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
	points := payload.Result.Points
	if profile.RerankerEnabledByDefault {
		return e.rerankPoints(ctx, search.QueryText, points)
	}
	return points, nil
}

func validateKnowledgeSearchQueryShape(
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
) error {
	_, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		CompareToVersionID: search.ResolvedVersion.CompareToVersionID,
		DenseEmbedding:     embedding,
		Mode:               search.ResolvedVersion.Mode,
		ServingConfig:      profile,
		QueryText:          search.QueryText,
		RetrievalAccess:    search.RetrievalAccess,
		TopK:               search.TopK,
		VersionID:          search.ResolvedVersion.VersionID,
	})
	return err
}

func (e qdrantKnowledgeSearchExecutor) validateAliasReleaseMetadata(
	ctx context.Context,
	profile retrievalruntime.ServingConfig,
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
			EmbeddingProvider:   embeddingConfig.Provider,
			Metadata:            metadata,
			ServingConfig:       profile,
		})
	}
	samples, err := e.readQdrantReleaseMetadataSamples(ctx, profile.QdrantAliasName)
	if err != nil {
		return err
	}
	return retrievalruntime.ValidateReleaseMetadataSamples(retrievalruntime.ReleaseGuardSamplesRequest{
		EmbeddingDimensions: embeddingConfig.Dimensions,
		EmbeddingModel:      embeddingConfig.Model,
		EmbeddingProvider:   embeddingConfig.Provider,
		MetadataSamples:     samples,
		ServingConfig:       profile,
	})
}

func (e qdrantKnowledgeSearchExecutor) readQdrantCollectionMetadata(
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

func (e qdrantKnowledgeSearchExecutor) readQdrantReleaseMetadataSamples(
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

func searchEvidenceFromQdrantPoint(point qdrantPoint) (retrievalruntime.Evidence, bool) {
	payload := point.Payload
	if len(payload) == 0 {
		return retrievalruntime.Evidence{}, false
	}
	metadata := qdrantPointMetadata(point)
	excerpt := qdrantPointText(point)
	if excerpt == "" {
		return retrievalruntime.Evidence{}, false
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
		return retrievalruntime.Evidence{}, false
	}
	return retrievalruntime.Evidence{
		EvidenceRef:  "evidence://sha256/" + retrievalruntime.HashText(sourceID+"\x00"+chunkID+"\x00"+spanRef),
		CanonicalURL: canonicalURL,
		Snippet:      excerpt,
		Title:        title,
		VersionID:    firstNonEmptyText(metadata["version_id"]),
	}, true
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
	return retrievalruntime.LoadServingConfig(e.servingConfigRoot, search.Corpus, search.Collection)
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

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
