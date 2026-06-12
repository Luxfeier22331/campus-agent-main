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

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/ragruntime"
)

type ragLookupExecutor interface {
	HealthCheck(context.Context) error
	Lookup(context.Context, ragruntime.PlanProjection) (ragruntime.RetrievalLookupResult, error)
}

type qdrantRAGLookupExecutor struct {
	embeddingAPIKey     string
	embeddingBaseURL    string
	embeddingDimensions int
	embeddingHTTPClient *http.Client
	embeddingModel      string
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
	timeout             time.Duration
}

func newQdrantRAGLookupExecutor(cfg config.Config) (ragLookupExecutor, error) {
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
	embeddingBaseURL := strings.TrimRight(strings.TrimSpace(cfg.EmbeddingBaseURL), "/")
	if embeddingBaseURL == "" {
		embeddingBaseURL = strings.TrimRight(strings.TrimSpace(cfg.PromptRuntimeBaseURL), "/")
	}
	if embeddingBaseURL == "" {
		return nil, errors.New("EMBEDDING_BASE_URL or PROMPT_RUNTIME_BASE_URL is required")
	}
	if strings.TrimSpace(cfg.EmbeddingAPIKey) == "" {
		return nil, errors.New("EMBEDDING_API_KEY is required for Go RAG lookup")
	}
	if strings.TrimSpace(cfg.EmbeddingModel) == "" {
		return nil, errors.New("EMBEDDING_MODEL is required for Go RAG lookup")
	}
	if cfg.EmbeddingDimensions <= 0 {
		return nil, errors.New("EMBEDDING_DIMENSIONS is required for Go RAG lookup")
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
		embeddingAPIKey:     strings.TrimSpace(cfg.EmbeddingAPIKey),
		embeddingBaseURL:    embeddingBaseURL,
		embeddingDimensions: cfg.EmbeddingDimensions,
		embeddingHTTPClient: &http.Client{Timeout: timeout},
		embeddingModel:      strings.TrimSpace(cfg.EmbeddingModel),
		httpClient:          httpClient,
		qdrantQueryAPIKey:   strings.TrimSpace(cfg.QdrantQueryAPIKey),
		qdrantURL:           qdrantURL,
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
	embedding, err := e.embedQuery(ctx, plan.QueryText)
	if err != nil {
		return ragruntime.RetrievalLookupResult{}, err
	}
	points, err := e.queryPoints(ctx, plan, embedding)
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
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("qdrant readyz status %d", response.StatusCode)
	}
	return nil
}

func (e qdrantRAGLookupExecutor) embedQuery(ctx context.Context, queryText string) ([]float64, error) {
	if e.embeddingHTTPClient == nil {
		return nil, errors.New("embedding HTTP client is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"model":      e.embeddingModel,
		"input":      strings.TrimSpace(queryText),
		"dimensions": e.embeddingDimensions,
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		e.embeddingBaseURL+"/embeddings",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+e.embeddingAPIKey)
	request.Header.Set("content-type", "application/json")
	response, err := e.embeddingHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
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
	if e.embeddingDimensions > 0 && len(payload.Data[0].Embedding) != e.embeddingDimensions {
		return nil, fmt.Errorf(
			"embedding dimension = %d, want %d",
			len(payload.Data[0].Embedding),
			e.embeddingDimensions,
		)
	}
	return payload.Data[0].Embedding, nil
}

func (e qdrantRAGLookupExecutor) queryPoints(
	ctx context.Context,
	plan ragruntime.PlanProjection,
	embedding []float64,
) ([]qdrantPoint, error) {
	body, err := json.Marshal(map[string]any{
		"limit":        plan.TopK,
		"with_payload": true,
		"with_vector":  false,
		"using":        "dense",
		"query":        embedding,
		"filter": map[string]any{
			"must": []map[string]any{
				qdrantMatchCondition("corpus", plan.Corpus),
				qdrantMatchCondition("collection", plan.Collection),
				qdrantMatchCondition("status", "active"),
				qdrantMatchCondition("is_current", true),
				qdrantMatchCondition("visibility_level", "public"),
			},
		},
	})
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(plan.CollectionAlias) + "/points/query"
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
	defer response.Body.Close()
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

func qdrantMatchCondition(key string, value any) map[string]any {
	return map[string]any{
		"key":   key,
		"match": map[string]any{"value": value},
	}
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
		ChunkID:   chunkID,
		Excerpt:   excerpt,
		Score:     point.Score,
		SourceID:  sourceID,
		SourceRef: sourceRef,
		SpanRef:   spanRef,
		Title: firstNonEmptyText(
			metadata["source_title"],
			metadata["title"],
			metadata["document_title"],
			metadata["canonical_source_title"],
		),
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

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
