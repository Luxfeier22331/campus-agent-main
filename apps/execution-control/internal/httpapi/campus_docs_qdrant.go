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
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	campusDocsEmbeddingTimeout = 10 * time.Second
	campusDocsQdrantTimeout    = 60 * time.Second
)

type campusDocsQdrantClient struct {
	embeddingHTTPClient *http.Client
	embeddingKind       providerConfigKind
	configResolver      providerConfigResolver
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
	timeout             time.Duration
}

func buildCampusDocsQdrantClient(
	cfg config.Config,
	configResolver providerConfigResolver,
) (campusDocsQdrantClient, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return campusDocsQdrantClient{}, errors.New("QDRANT_URL is required for Campus docs retrieval")
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return campusDocsQdrantClient{}, fmt.Errorf("QDRANT_URL must be a valid http(s) URL: %w", err)
	}
	if parsedQdrantURL.Scheme != "http" && parsedQdrantURL.Scheme != "https" {
		return campusDocsQdrantClient{}, errors.New("QDRANT_URL must use http or https")
	}
	if parsedQdrantURL.Scheme == "http" && isDeployedEnvironment(cfg.DeploymentEnvironment) {
		return campusDocsQdrantClient{}, errors.New("QDRANT_URL must use https for authenticated Qdrant data-plane")
	}
	if strings.TrimSpace(cfg.QdrantReadOnlyAPIKey) == "" {
		return campusDocsQdrantClient{}, errors.New("QDRANT_READ_ONLY_API_KEY is required for Campus docs retrieval")
	}
	httpClient, err := qdrantHTTPClient(parsedQdrantURL.Scheme, campusDocsQdrantTimeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return campusDocsQdrantClient{}, err
	}
	return campusDocsQdrantClient{
		embeddingHTTPClient: &http.Client{Timeout: campusDocsEmbeddingTimeout},
		embeddingKind:       providerConfigKindEmbedding,
		configResolver:      configResolver,
		httpClient:          httpClient,
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantReadOnlyAPIKey),
		qdrantURL:           qdrantURL,
		timeout:             campusDocsQdrantTimeout,
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
		Transport: &http.Transport{TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			RootCAs:    rootCAs,
		}},
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

func (e campusDocsQdrantClient) embedQueryWithProviderConfig(
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
	baseURL, err := providerconfig.NormalizeBaseURL(embeddingConfig.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("embedding provider base url: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(baseURL, "/")+"/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+embeddingConfig.APIKey)
	request.Header.Set("content-type", "application/json")
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

func (e campusDocsQdrantClient) resolveEmbeddingProviderConfig(
	ctx context.Context,
	pins ...providerConfigAdmissionPin,
) (providerConfigSnapshot, error) {
	kind := e.embeddingKind
	if kind == "" {
		kind = providerConfigKindEmbedding
	}
	if e.configResolver == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	snapshot, err := e.configResolver.ResolveActiveProviderConfig(ctx, kind)
	if err != nil {
		return providerConfigSnapshot{}, err
	}
	if len(pins) == 0 {
		return snapshot, nil
	}
	pin := pins[0]
	if !pin.valid() {
		return providerConfigSnapshot{}, errors.New("embedding provider admission pin is invalid")
	}
	if providerConfigAdmissionHash(snapshot) != pin.ConfigSHA256 {
		return providerConfigSnapshot{}, errors.New("embedding provider configuration does not match admission")
	}
	return snapshot, nil
}

func (e campusDocsQdrantClient) queryCampusDocsPoints(
	ctx context.Context,
	query string,
	embedding []float64,
	embeddingConfig providerConfigSnapshot,
	target *temporalruntime.CampusDocsIndexSnapshot,
) ([]qdrantPoint, error) {
	if err := validateCampusDocsEmbeddingAdmission(target, embeddingConfig); err != nil {
		return nil, err
	}
	if len(embedding) != target.EmbeddingDimensions {
		return nil, errors.New("query embedding dimensions do not match the admitted Campus docs index")
	}
	bodyPayload, err := campusdocs.BuildHybridQueryBody(campusdocs.HybridQuery{
		DenseEmbedding:   embedding,
		DenseVectorName:  target.DenseVectorName,
		QueryText:        query,
		SparseVectorName: target.SparseVectorName,
		TopK:             campusDocsCandidateLimit,
	})
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(target.Collection) + "/points/query"
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
	return decodeCampusDocsQdrantQueryResponse(responseBody)
}

func decodeCampusDocsQdrantQueryResponse(responseBody []byte) ([]qdrantPoint, error) {
	var payload struct {
		Result *struct {
			Points *[]qdrantPointWire `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant query response: %w", err)
	}
	if payload.Result == nil {
		return nil, errors.New("qdrant query response result is missing or null")
	}
	if payload.Result.Points == nil {
		return nil, errors.New("qdrant query response points are missing or null")
	}
	points := make([]qdrantPoint, 0, len(*payload.Result.Points))
	for index, point := range *payload.Result.Points {
		if point.Payload == nil {
			return nil, fmt.Errorf("qdrant query response point %d payload is missing or null", index)
		}
		if point.Score == nil {
			return nil, fmt.Errorf("qdrant query response point %d score is missing or null", index)
		}
		points = append(points, qdrantPoint{
			ID:      point.ID,
			Payload: *point.Payload,
			Score:   *point.Score,
		})
	}
	return points, nil
}

type qdrantPointWire struct {
	ID      any             `json:"id"`
	Payload *map[string]any `json:"payload"`
	Score   *float64        `json:"score"`
}

type qdrantPoint struct {
	ID      any            `json:"id"`
	Payload map[string]any `json:"payload"`
	Score   float64        `json:"score"`
}
