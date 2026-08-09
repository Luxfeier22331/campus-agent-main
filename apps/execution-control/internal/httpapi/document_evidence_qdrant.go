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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/retrievalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type documentEvidenceExecutor interface {
	CheckEmbeddingCompatibility(context.Context, providerConfigSnapshot) error
}

type qdrantDocumentEvidenceExecutor struct {
	embeddingHTTPClient *http.Client
	embeddingKind       providerConfigKind
	configResolver      providerConfigResolver
	httpClient          *http.Client
	knowledgeReadModel  *toolreadmodel.Runtime
	queryTargetsPath    string
	qdrantQueryAPIKey   string
	qdrantURL           string
	servingConfigRoot   string
	timeout             time.Duration
}

func newQdrantDocumentEvidenceExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
	knowledgeReadModel *toolreadmodel.Runtime,
) (documentEvidenceExecutor, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return nil, errors.New("QDRANT_URL is required for document evidence retrieval")
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
	if strings.TrimSpace(cfg.QdrantReadOnlyAPIKey) == "" {
		return nil, errors.New("QDRANT_READ_ONLY_API_KEY is required for online Qdrant lookup")
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
	return qdrantDocumentEvidenceExecutor{
		embeddingHTTPClient: &http.Client{Timeout: embeddingTimeout},
		embeddingKind:       providerConfigKindEmbedding,
		configResolver:      configResolver,
		httpClient:          httpClient,
		knowledgeReadModel:  knowledgeReadModel,
		queryTargetsPath:    strings.TrimSpace(cfg.QueryServingTargetsPath),
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantReadOnlyAPIKey),
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
		return noRedirectHTTPClient(&http.Client{Timeout: timeout}), nil
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
	return noRedirectHTTPClient(&http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS12,
				RootCAs:    rootCAs,
			},
		},
	}), nil
}

func noRedirectHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		return &http.Client{CheckRedirect: rejectHTTPRedirect}
	}
	clone := *client
	clone.CheckRedirect = rejectHTTPRedirect
	return &clone
}

func rejectHTTPRedirect(_ *http.Request, _ []*http.Request) error {
	return http.ErrUseLastResponse
}

func (e qdrantDocumentEvidenceExecutor) CheckEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	scopes, err := runtimepolicy.QueryServingScopes(e.queryTargetsPath)
	if err != nil {
		return err
	}
	if len(scopes) == 0 {
		return errors.New("no query-serving configs are available for document evidence compatibility check")
	}
	if e.knowledgeReadModel == nil {
		return errors.New("knowledge release read model is not configured")
	}
	for _, scope := range scopes {
		profile, err := retrievalruntime.LoadServingConfigPath(
			servingConfigScanRoot(e.servingConfigRoot),
			scope.ServingConfigPath,
		)
		if err != nil {
			return err
		}
		release, found, err := e.knowledgeReadModel.CurrentKnowledgeRelease(ctx, scope.Scope)
		if err != nil {
			return err
		}
		if !found || strings.TrimSpace(release.QdrantCollection) == "" {
			return fmt.Errorf("document scope %s does not have a current knowledge release", scope.Scope)
		}
		if err := e.validateCollectionCompatibility(
			ctx,
			profile,
			snapshot,
			release.QdrantCollection,
		); err != nil {
			return fmt.Errorf("%s/%s: %w", profile.Corpus, profile.Collection, err)
		}
	}
	return nil
}

func (e qdrantDocumentEvidenceExecutor) queryServingConfigs() ([]retrievalruntime.ServingConfig, error) {
	root := servingConfigScanRoot(e.servingConfigRoot)
	scopes, err := runtimepolicy.QueryServingScopes(e.queryTargetsPath)
	if err != nil {
		return nil, err
	}
	profiles := make([]retrievalruntime.ServingConfig, 0, len(scopes))
	for _, scope := range scopes {
		profile, err := retrievalruntime.LoadServingConfigPath(root, scope.ServingConfigPath)
		if err != nil {
			return nil, err
		}
		if profile.Collection != scope.Collection {
			return nil, fmt.Errorf(
				"document scope %s collection = %q, serving config collection = %q",
				scope.Scope,
				scope.Collection,
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

func (e qdrantDocumentEvidenceExecutor) embedQuery(ctx context.Context, queryText string) ([]float64, error) {
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.embedQueryWithProviderConfig(ctx, embeddingConfig, queryText)
}

func (e qdrantDocumentEvidenceExecutor) embedQueryWithProviderConfig(
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
	baseURL, err := providerconfig.NormalizeBaseURL(embeddingConfig.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("embedding provider base url: %w", err)
	}
	request.URL, err = url.Parse(strings.TrimRight(baseURL, "/") + "/embeddings")
	if err != nil {
		return nil, fmt.Errorf("embedding provider endpoint: %w", err)
	}
	response, err := noRedirectHTTPClient(e.embeddingHTTPClient).Do(request)
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

func (e qdrantDocumentEvidenceExecutor) resolveEmbeddingProviderConfig(
	ctx context.Context,
	pins ...providerConfigAdmissionPin,
) (providerConfigSnapshot, error) {
	kind := e.embeddingKind
	if kind == "" {
		kind = providerConfigKindEmbedding
	}
	if e.configResolver != nil {
		snapshot, err := e.configResolver.ResolveActiveProviderConfig(ctx, kind)
		if err != nil {
			return providerConfigSnapshot{}, err
		}
		if len(pins) > 0 {
			pin := pins[0]
			if !pin.valid() {
				return providerConfigSnapshot{}, errors.New("embedding provider admission pin is invalid")
			}
			if providerConfigAdmissionHash(snapshot) != pin.ConfigSHA256 {
				return providerConfigSnapshot{}, errors.New(
					"embedding provider configuration does not match admission",
				)
			}
			return snapshot, nil
		}
		return snapshot, nil
	}
	return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
}

func (e qdrantDocumentEvidenceExecutor) queryPoints(
	ctx context.Context,
	request retrievalruntime.SearchRequest,
	embedding []float64,
) ([]qdrantPoint, error) {
	profile, err := e.servingConfig(request)
	if err != nil {
		return nil, err
	}
	if err := validateDocumentEvidenceQueryShape(request, profile, embedding); err != nil {
		return nil, err
	}
	embeddingConfig, err := e.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	return e.queryPointsWithProfileAndProviderConfig(ctx, request, profile, embedding, embeddingConfig)
}

func (e qdrantDocumentEvidenceExecutor) queryPointsWithProviderConfig(
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

func (e qdrantDocumentEvidenceExecutor) queryPointsWithProfileAndProviderConfig(
	ctx context.Context,
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
) ([]qdrantPoint, error) {
	qdrantCollection, err := e.currentQdrantCollection(ctx, search.DocumentScope)
	if err != nil {
		return nil, err
	}
	return e.queryPointsInCollectionWithProfileAndProviderConfig(
		ctx,
		search,
		profile,
		embedding,
		embeddingConfig,
		qdrantCollection,
	)
}

func (e qdrantDocumentEvidenceExecutor) currentQdrantCollection(
	ctx context.Context,
	documentScope string,
) (string, error) {
	if e.knowledgeReadModel == nil {
		return "", errors.New("knowledge release read model is not configured")
	}
	release, found, err := e.knowledgeReadModel.CurrentKnowledgeRelease(ctx, documentScope)
	if err != nil {
		return "", err
	}
	if !found || strings.TrimSpace(release.QdrantCollection) == "" {
		return "", fmt.Errorf("document scope %s does not have a current knowledge release", documentScope)
	}
	return release.QdrantCollection, nil
}

func (e qdrantDocumentEvidenceExecutor) queryPointsInCollectionWithProfileAndProviderConfig(
	ctx context.Context,
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
	qdrantCollection string,
) ([]qdrantPoint, error) {
	if err := validateEmbeddingProfileCompatibility(profile, embeddingConfig, len(embedding)); err != nil {
		return nil, err
	}
	qdrantCollection = strings.TrimSpace(qdrantCollection)
	if qdrantCollection == "" {
		return nil, errors.New("qdrant collection is required")
	}
	bodyPayload, err := retrievalruntime.BuildHybridQueryBody(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		ServingConfig:   profile,
		QueryText:       search.QueryText,
		RetrievalAccess: search.RetrievalAccess,
		TopK:            search.CandidateTopK,
	})
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(qdrantCollection) + "/points/query"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := noRedirectHTTPClient(e.httpClient).Do(request)
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

func validateDocumentEvidenceQueryShape(
	search retrievalruntime.SearchRequest,
	profile retrievalruntime.ServingConfig,
	embedding []float64,
) error {
	_, err := retrievalruntime.BuildQdrantFilter(retrievalruntime.QueryRequest{
		DenseEmbedding:  embedding,
		ServingConfig:   profile,
		QueryText:       search.QueryText,
		RetrievalAccess: search.RetrievalAccess,
		TopK:            search.CandidateTopK,
	})
	return err
}

func (e qdrantDocumentEvidenceExecutor) validateCollectionCompatibility(
	ctx context.Context,
	profile retrievalruntime.ServingConfig,
	embeddingConfig providerConfigSnapshot,
	collection string,
) error {
	if err := validateEmbeddingProfileCompatibility(profile, embeddingConfig, profile.EmbeddingDimensions); err != nil {
		return err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(strings.TrimSpace(collection))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("api-key", e.qdrantQueryAPIKey)
	response, err := noRedirectHTTPClient(e.httpClient).Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant collection status %d", response.StatusCode)
	}
	var payload map[string]any
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return fmt.Errorf("parse qdrant collection response: %w", err)
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

func (e qdrantDocumentEvidenceExecutor) servingConfig(search retrievalruntime.SearchRequest) (retrievalruntime.ServingConfig, error) {
	scope, err := runtimepolicy.ResolveDocumentScope(search.DocumentScope, e.queryTargetsPath)
	if err != nil {
		return retrievalruntime.ServingConfig{}, err
	}
	if scope.ServingConfigPath != search.ServingConfigPath {
		return retrievalruntime.ServingConfig{}, fmt.Errorf(
			"document scope %s serving config path does not match the registry",
			search.DocumentScope,
		)
	}
	profile, err := retrievalruntime.LoadServingConfigPath(e.servingConfigRoot, search.ServingConfigPath)
	if err != nil {
		return retrievalruntime.ServingConfig{}, err
	}
	if profile.Collection != scope.Collection {
		return retrievalruntime.ServingConfig{}, fmt.Errorf(
			"document scope %s collection = %q, serving config collection = %q",
			search.DocumentScope,
			scope.Collection,
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
