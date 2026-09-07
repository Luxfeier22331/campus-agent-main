package outboundadapter

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdocs"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

const (
	campusDocsEmbeddingTimeout         = 10 * time.Second
	campusDocsRerankTimeout            = 45 * time.Second
	campusDocsQdrantTimeout            = 60 * time.Second
	campusDocsCandidateLimit           = 24
	campusDocsRerankRelevanceThreshold = 0.5
)

type runtimeConfigResolver interface {
	ResolveRuntimeConfig(context.Context, string) (modelconfigclient.RuntimeConfig, error)
}

type campusDocsHTTPClient struct {
	embeddingHTTPClient *http.Client
	rerankHTTPClient    *http.Client
	modelConfigResolver runtimeConfigResolver
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
}

type campusDocsCandidate struct {
	dedupKey string
	result   campusdocs.SearchResultItem
}

type campusDocsRerankResultWire struct {
	Index          *int     `json:"index"`
	RelevanceScore *float64 `json:"relevance_score"`
}

type qdrantPointWire struct {
	ID      any             `json:"id"`
	Payload *map[string]any `json:"payload"`
	Score   *float64        `json:"score"`
}

type qdrantPoint struct {
	ID      any
	Payload map[string]any
	Score   float64
}

// NewCampusDocsSearcher constructs the single outbound owner for embedding,
// Qdrant and reranker calls used by the Campus Docs tool.
func NewCampusDocsSearcher(
	cfg config.Config,
	modelConfigResolver runtimeConfigResolver,
) (campusdocs.Searcher, error) {
	qdrantURL := strings.TrimRight(strings.TrimSpace(cfg.QdrantURL), "/")
	if qdrantURL == "" {
		return nil, errors.New("qdrant_url is required for Campus docs retrieval")
	}
	parsedQdrantURL, err := url.ParseRequestURI(qdrantURL)
	if err != nil {
		return nil, fmt.Errorf("qdrant_url must be a valid http(s) URL: %w", err)
	}
	if parsedQdrantURL.Scheme != "http" && parsedQdrantURL.Scheme != "https" {
		return nil, errors.New("qdrant_url must use http or https")
	}
	if parsedQdrantURL.Scheme == "http" && deployedEnvironment(cfg.DeploymentEnvironment) {
		return nil, errors.New("qdrant_url must use https for authenticated Qdrant data-plane")
	}
	if strings.TrimSpace(cfg.QdrantReadOnlyAPIKey) == "" {
		return nil, errors.New("qdrant_read_only_api_key is required for Campus docs retrieval")
	}
	qdrantClient, err := qdrantHTTPClient(parsedQdrantURL.Scheme, campusDocsQdrantTimeout, cfg.QdrantTLSCACertPath)
	if err != nil {
		return nil, err
	}
	return &campusDocsHTTPClient{
		embeddingHTTPClient: NoRedirectHTTPClient(&http.Client{Timeout: campusDocsEmbeddingTimeout}),
		rerankHTTPClient:    NoRedirectHTTPClient(&http.Client{Timeout: campusDocsRerankTimeout}),
		modelConfigResolver: modelConfigResolver,
		httpClient:          qdrantClient,
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantReadOnlyAPIKey),
		qdrantURL:           qdrantURL,
	}, nil
}

func deployedEnvironment(environment string) bool {
	normalized := strings.ToLower(strings.TrimSpace(environment))
	return normalized == "staging" || normalized == "production"
}

func qdrantHTTPClient(scheme string, timeout time.Duration, caCertPath string) (*http.Client, error) {
	if scheme == "http" {
		return NoRedirectHTTPClient(&http.Client{Timeout: timeout}), nil
	}
	trimmedCAPath := strings.TrimSpace(caCertPath)
	if trimmedCAPath == "" {
		return nil, errors.New("qdrant_tls_ca_cert_path is required for HTTPS Qdrant data-plane")
	}
	caBytes, err := os.ReadFile(trimmedCAPath)
	if err != nil {
		return nil, fmt.Errorf("read qdrant_tls_ca_cert_path: %w", err)
	}
	rootCAs := x509.NewCertPool()
	if ok := rootCAs.AppendCertsFromPEM(caBytes); !ok {
		return nil, errors.New("qdrant_tls_ca_cert_path must contain at least one PEM certificate")
	}
	return NoRedirectHTTPClient(&http.Client{
		Timeout: timeout,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{
			MinVersion: tls.VersionTLS12,
			RootCAs:    rootCAs,
		}},
	}), nil
}

func (client *campusDocsHTTPClient) Search(
	ctx context.Context,
	index campusdocs.Index,
	query string,
	resultLimit int,
) ([]campusdocs.SearchResultItem, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, errors.New("campus docs query is required")
	}
	if err := campusdocs.ValidateIndex(index); err != nil {
		return nil, err
	}
	embeddingConfig, err := client.resolveEmbeddingProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	embedding, err := client.embedQueryWithRuntimeConfig(
		ctx,
		embeddingConfig,
		campusdocs.BuildDenseQueryText(query, campusdocs.EmbeddingQueryInstruction),
		campusdocs.EmbeddingDimensions,
	)
	if err != nil {
		return nil, err
	}
	points, err := client.queryCampusDocsPoints(ctx, query, embedding, index)
	if err != nil {
		return nil, err
	}
	candidates := make([]campusDocsCandidate, 0, len(points))
	seen := map[string]struct{}{}
	for _, point := range points {
		candidate, err := campusDocsCandidateFromQdrantPoint(index, point)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[candidate.dedupKey]; exists {
			continue
		}
		seen[candidate.dedupKey] = struct{}{}
		candidates = append(candidates, candidate)
	}
	if len(candidates) > campusDocsCandidateLimit {
		return nil, errors.New("campus docs Qdrant response exceeds the candidate limit")
	}
	if len(candidates) == 0 {
		return []campusdocs.SearchResultItem{}, nil
	}
	rerankerConfig, err := client.resolveRerankerProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	rankedCandidates, err := client.rerankCampusDocsCandidates(ctx, rerankerConfig, query, candidates)
	if err != nil {
		return nil, err
	}

	results := make([]campusdocs.SearchResultItem, 0, resultLimit)
	characterCount := 0
	for _, candidate := range rankedCandidates {
		if len(results) >= resultLimit {
			break
		}
		textLength := utf8.RuneCountInString(candidate.result.Text)
		if characterCount+textLength > campusdocs.EvidenceCharBudget {
			continue
		}
		results = append(results, candidate.result)
		characterCount += textLength
	}
	return results, nil
}

func (client *campusDocsHTTPClient) embedQueryWithRuntimeConfig(
	ctx context.Context,
	embeddingConfig modelconfigclient.RuntimeConfig,
	queryText string,
	dimensions int,
) ([]float64, error) {
	if client == nil || client.embeddingHTTPClient == nil {
		return nil, errors.New("embedding HTTP client is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"model":      embeddingConfig.Model,
		"input":      strings.TrimSpace(queryText),
		"dimensions": dimensions,
	})
	if err != nil {
		return nil, err
	}
	baseURL, err := modelconfigclient.NormalizeBaseURL(embeddingConfig.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("embedding provider base url: %w", err)
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		baseURL+"/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+embeddingConfig.APIKey)
	request.Header.Set("content-type", "application/json")
	response, err := NoRedirectHTTPClient(client.embeddingHTTPClient).Do(request)
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
	embedding := payload.Data[0].Embedding
	if len(embedding) != dimensions {
		return nil, fmt.Errorf("embedding dimension = %d, want %d", len(embedding), dimensions)
	}
	if err := validateCampusDocsEmbedding(embedding); err != nil {
		return nil, err
	}
	return embedding, nil
}

func (client *campusDocsHTTPClient) resolveEmbeddingProviderConfig(
	ctx context.Context,
) (modelconfigclient.RuntimeConfig, error) {
	if client == nil || client.modelConfigResolver == nil {
		return modelconfigclient.RuntimeConfig{}, errors.New("model config resolver is not configured")
	}
	return client.modelConfigResolver.ResolveRuntimeConfig(ctx, "campus_docs_embedding")
}

func (client *campusDocsHTTPClient) resolveRerankerProviderConfig(
	ctx context.Context,
) (modelconfigclient.RuntimeConfig, error) {
	if client == nil || client.modelConfigResolver == nil {
		return modelconfigclient.RuntimeConfig{}, errors.New("model config resolver is not configured")
	}
	return client.modelConfigResolver.ResolveRuntimeConfig(ctx, "campus_docs_reranker")
}

func (client *campusDocsHTTPClient) queryCampusDocsPoints(
	ctx context.Context,
	query string,
	embedding []float64,
	target campusdocs.Index,
) ([]qdrantPoint, error) {
	if client == nil || client.httpClient == nil {
		return nil, errors.New("qdrant HTTP client is not configured")
	}
	if err := campusdocs.ValidateIndex(target); err != nil {
		return nil, err
	}
	if err := validateCampusDocsEmbedding(embedding); err != nil {
		return nil, err
	}
	bodyPayload, err := campusdocs.BuildHybridQueryBody(campusdocs.HybridQuery{
		DenseEmbedding:   embedding,
		DenseVectorName:  campusdocs.DenseVectorName,
		QueryText:        query,
		SparseVectorName: campusdocs.SparseVectorName,
		TopK:             campusDocsCandidateLimit,
	})
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(bodyPayload)
	if err != nil {
		return nil, err
	}
	endpoint := client.qdrantURL + "/collections/" + url.PathEscape(target.Collection) + "/points/query"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("api-key", client.qdrantQueryAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := NoRedirectHTTPClient(client.httpClient).Do(request)
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

func validateCampusDocsEmbedding(embedding []float64) error {
	if len(embedding) != campusdocs.EmbeddingDimensions {
		return fmt.Errorf(
			"query embedding dimensions = %d, want %d",
			len(embedding),
			campusdocs.EmbeddingDimensions,
		)
	}
	for index, value := range embedding {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("embedding value %d is not finite", index)
		}
	}
	return nil
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
		points = append(points, qdrantPoint{ID: point.ID, Payload: *point.Payload, Score: *point.Score})
	}
	return points, nil
}

func campusDocsCandidateFromQdrantPoint(
	index campusdocs.Index,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	if err := campusdocs.ValidateIndex(index); err != nil {
		return campusDocsCandidate{}, err
	}
	payload := point.Payload
	sourceKind := execution.FirstNonEmptyText(payload["source_kind"])
	if sourceKind == "notice" {
		return campusNoticeCandidateFromQdrantPoint(index, point)
	}
	required := map[string]string{
		"schema_version":        execution.FirstNonEmptyText(payload["schema_version"]),
		"chunk_id":              execution.FirstNonEmptyText(payload["chunk_id"]),
		"section_ref":           execution.FirstNonEmptyText(payload["section_ref"]),
		"document_id":           execution.FirstNonEmptyText(payload["document_id"]),
		"document_title":        execution.FirstNonEmptyText(payload["document_title"]),
		"section_title":         execution.FirstNonEmptyText(payload["section_title"]),
		"text":                  execution.FirstNonEmptyText(payload["text"]),
		"text_sha256":           execution.FirstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": execution.FirstNonEmptyText(payload["retrieval_text_sha256"]),
		"version_id":            execution.FirstNonEmptyText(payload["version_id"]),
		"version_slug":          execution.FirstNonEmptyText(payload["version_slug"]),
	}
	for field, value := range required {
		if value == "" {
			return campusDocsCandidate{}, fmt.Errorf("campus docs Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_docs_point.v3" && required["schema_version"] != "campus_rag_point.v1" {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload schema is unsupported")
	}
	if !campusdocs.ValidVersionSlug(required["version_slug"]) ||
		!campusdocs.ValidVersionedSectionRef(required["section_ref"], required["version_slug"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload section_ref is invalid")
	}
	if !execution.ValidSHA256Ref(required["text_sha256"]) ||
		execution.SHA256TextRef(required["text"]) != required["text_sha256"] {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text hash is invalid")
	}
	if !execution.ValidSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload retrieval text hash is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant score is invalid")
	}
	rootUnitIDs, ok := campusdocs.DecodeRootUnitIDs(payload["root_unit_ids"])
	if !ok {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload root_unit_ids is invalid")
	}
	if textLength := utf8.RuneCountInString(required["text"]); textLength < 1 || textLength > campusdocs.EvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text length is invalid")
	}
	dedupKey := strings.Join([]string{index.Collection, required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		dedupKey: dedupKey,
		result: campusdocs.SearchResultItem{
			ResultRef:    "result://" + strings.TrimPrefix(execution.SHA256TextRef(dedupKey), "sha256:"),
			SourceKind:   "document",
			DocumentID:   required["document_id"],
			Title:        required["document_title"],
			SectionRef:   required["section_ref"],
			SectionTitle: required["section_title"],
			RootUnitIDs:  rootUnitIDs,
			VersionID:    required["version_id"],
			VersionSlug:  required["version_slug"],
			Text:         required["text"],
		},
	}, nil
}

func campusNoticeCandidateFromQdrantPoint(
	index campusdocs.Index,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	payload := point.Payload
	required := map[string]string{
		"schema_version":        execution.FirstNonEmptyText(payload["schema_version"]),
		"chunk_id":              execution.FirstNonEmptyText(payload["chunk_id"]),
		"notice_id":             execution.FirstNonEmptyText(payload["notice_id"]),
		"title":                 execution.FirstNonEmptyText(payload["title"]),
		"section_title":         execution.FirstNonEmptyText(payload["section_title"]),
		"citation_href":         execution.FirstNonEmptyText(payload["citation_href"]),
		"text":                  execution.FirstNonEmptyText(payload["text"]),
		"text_sha256":           execution.FirstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": execution.FirstNonEmptyText(payload["retrieval_text_sha256"]),
	}
	for field, value := range required {
		if value == "" {
			return campusDocsCandidate{}, fmt.Errorf("campus notice Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_rag_point.v1" ||
		!campusdocs.ValidNoticeCitationHrefForNoticeID(required["citation_href"], required["notice_id"]) ||
		!execution.ValidSHA256Ref(required["text_sha256"]) ||
		execution.SHA256TextRef(required["text"]) != required["text_sha256"] ||
		!execution.ValidSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant payload is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant score is invalid")
	}
	if textLength := utf8.RuneCountInString(required["text"]); textLength < 1 || textLength > campusdocs.EvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant payload text length is invalid")
	}
	dedupKey := strings.Join([]string{index.Collection, "notice", required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		dedupKey: dedupKey,
		result: campusdocs.SearchResultItem{
			CitationHref: required["citation_href"],
			NoticeID:     required["notice_id"],
			ResultRef:    "result://" + strings.TrimPrefix(execution.SHA256TextRef(dedupKey), "sha256:"),
			SectionTitle: required["section_title"],
			SourceKind:   "notice",
			Text:         required["text"],
			Title:        required["title"],
		},
	}, nil
}

func (client *campusDocsHTTPClient) rerankCampusDocsCandidates(
	ctx context.Context,
	provider modelconfigclient.RuntimeConfig,
	query string,
	candidates []campusDocsCandidate,
) ([]campusDocsCandidate, error) {
	if len(candidates) == 0 {
		return []campusDocsCandidate{}, nil
	}
	if client == nil || client.rerankHTTPClient == nil {
		return nil, errors.New("reranker HTTP client is not configured")
	}
	baseURL, err := modelconfigclient.NormalizeBaseURL(provider.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("reranker provider base url: %w", err)
	}
	documents := make([]string, len(candidates))
	for index, candidate := range candidates {
		documents[index] = strings.Join([]string{
			strings.TrimSpace(candidate.result.Title),
			strings.TrimSpace(candidate.result.SectionTitle),
			strings.TrimSpace(candidate.result.Text),
		}, "\n")
	}
	body, err := json.Marshal(map[string]any{
		"documents": documents,
		"model":     provider.Model,
		"query":     strings.TrimSpace(query),
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/rerank", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("authorization", "Bearer "+provider.APIKey)
	request.Header.Set("content-type", "application/json")
	if provider.Provider == "cohere-compatible" {
		request.Header.Set("X-Failover-Enabled", "true")
	}
	response, err := NoRedirectHTTPClient(client.rerankHTTPClient).Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("reranker provider status %d", response.StatusCode)
	}
	var payload struct {
		Results []campusDocsRerankResultWire `json:"results"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse reranker response: %w", err)
	}
	if err := validateCampusDocsRerankResults(payload.Results, len(candidates)); err != nil {
		return nil, err
	}
	type rankedCandidate struct {
		candidate campusDocsCandidate
		index     int
		score     float64
	}
	ranked := make([]rankedCandidate, 0, len(payload.Results))
	for _, result := range payload.Results {
		ranked = append(ranked, rankedCandidate{
			candidate: candidates[*result.Index],
			index:     *result.Index,
			score:     *result.RelevanceScore,
		})
	}
	sort.SliceStable(ranked, func(left, right int) bool {
		if ranked[left].score == ranked[right].score {
			return ranked[left].index < ranked[right].index
		}
		return ranked[left].score > ranked[right].score
	})
	result := make([]campusDocsCandidate, 0, len(ranked))
	for _, item := range ranked {
		if item.score < campusDocsRerankRelevanceThreshold {
			break
		}
		result = append(result, item.candidate)
	}
	return result, nil
}

func validateCampusDocsRerankResults(results []campusDocsRerankResultWire, candidateCount int) error {
	if candidateCount < 1 || len(results) != candidateCount {
		return errors.New("reranker response result count is invalid")
	}
	seen := make(map[int]struct{}, len(results))
	for _, result := range results {
		if result.Index == nil || result.RelevanceScore == nil ||
			*result.Index < 0 || *result.Index >= candidateCount {
			return errors.New("reranker response index is invalid")
		}
		if _, exists := seen[*result.Index]; exists {
			return errors.New("reranker response index is duplicated")
		}
		seen[*result.Index] = struct{}{}
		if math.IsNaN(*result.RelevanceScore) || math.IsInf(*result.RelevanceScore, 0) {
			return errors.New("reranker response score is invalid")
		}
	}
	return nil
}
