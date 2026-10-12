package outbound

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	searchapi "github.com/MUC-WIKI/campus-agent/packages/search-api-go"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/embedding"
	"github.com/MUC-WIKI/campus-agent/apps/campus-search/internal/modelconfig"
)

const (
	campusDocsEmbeddingTimeout         = 20 * time.Second
	campusDocsRerankTimeout            = 45 * time.Second
	campusDocsQdrantTimeout            = 60 * time.Second
	campusDocsCandidateLimit           = 24
	campusDocsRerankRelevanceThreshold = 0.5
)

type runtimeConfigResolver interface {
	ResolveRuntimeConfig(context.Context, string) (modelconfigclient.RuntimeConfig, error)
}

type Config struct {
	DeploymentEnvironment string
	QdrantURL             string
	QdrantReadOnlyAPIKey  string
	QdrantTLSCACertPath   string
}

type campusDocsHTTPClient struct {
	embedder            embedding.Embedder
	rerankHTTPClient    *http.Client
	modelConfigResolver runtimeConfigResolver
	httpClient          *http.Client
	qdrantQueryAPIKey   string
	qdrantURL           string
}

func FirstNonEmptyText(values ...any) string {
	for _, value := range values {
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "<nil>" && text != "" {
			return text
		}
	}
	return ""
}

func ValidSHA256Ref(value string) bool {
	value = strings.TrimPrefix(strings.TrimSpace(value), "sha256:")
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func SHA256TextRef(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

type campusDocsCandidate struct {
	dedupKey   string
	result     searchapi.SearchResultItem
	diagnostic *campussearch.Candidate
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
	cfg Config,
	modelConfigResolver runtimeConfigResolver,
	logger *slog.Logger,
) (campussearch.Searcher, error) {
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
		embedder: &campusDocsEmbedder{
			resolver:   modelConfigResolver,
			httpClient: NoRedirectHTTPClient(&http.Client{Timeout: campusDocsEmbeddingTimeout}),
			cache:      embedding.NewCache(embedding.DefaultCapacity, embedding.DefaultTTL, campusDocsEmbeddingTimeout, logger),
		},
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
	index campussearch.Index,
	queries campussearch.SearchQuery,
	resultLimit int,
) ([]searchapi.SearchResultItem, error) {
	query := strings.TrimSpace(queries.RetrievalQuery)
	rerankQuery := strings.TrimSpace(queries.RerankQuery)
	observer := campussearch.SearchObservation(ctx)
	snapshot := observer.Snapshot
	snapshot.RetrievalMode = "hybrid_rrf"
	if len(campussearch.BuildSparseVector(query).Indices) == 0 {
		snapshot.RetrievalMode = "dense"
	}
	started := time.Now()
	stage := "embedding"
	snapshot.FailedStage = stage
	defer func() {
		if snapshot.FailedStage != "" {
			snapshot.Durations[stage] = time.Since(started).Milliseconds()
		}
	}()
	snapshot.Retrieval = &campussearch.RetrievalMeta{Collection: index.Collection}
	if query == "" || rerankQuery == "" {
		return nil, errors.New("campus docs retrieval query and rerank query are required")
	}
	if err := campussearch.ValidateIndex(index); err != nil {
		return nil, err
	}
	embedding, err := client.embedder.Embed(ctx, embedding.Request{
		Input:              campussearch.BuildDenseQueryText(query, campussearch.EmbeddingQueryInstruction),
		Dimensions:         campussearch.EmbeddingDimensions,
		InstructionVersion: "campus-query.v1",
	})
	if err != nil {
		return nil, err
	}
	snapshot.Durations["embedding"] = time.Since(started).Milliseconds()
	observer.Phase("embedded")
	started = time.Now()
	stage, snapshot.FailedStage = "retrieval", "retrieval"
	points, err := client.queryCampusDocsPoints(ctx, query, rerankQuery, embedding, index)
	if err != nil {
		return nil, err
	}
	postprocessStarted := time.Now()
	candidates := make([]campusDocsCandidate, 0, len(points))
	snapshot.Candidates = make([]campussearch.Candidate, 0, campusDocsCandidateLimit)
	snapshot.RetrievedCount = len(points)
	seen := map[string]struct{}{}
	for pointIndex, point := range points {
		candidate, err := campusDocsCandidateFromQdrantPoint(index, point)
		if err != nil {
			return nil, err
		}
		if _, exists := seen[candidate.dedupKey]; exists {
			continue
		}
		seen[candidate.dedupKey] = struct{}{}
		if utf8.RuneCountInString(candidate.result.Title) > 400 || utf8.RuneCountInString(candidate.result.SectionTitle) > 400 {
			snapshot.SnapshotTruncated = true
		}
		if len(snapshot.Candidates) < campusDocsCandidateLimit {
			snapshot.Candidates = append(snapshot.Candidates, campussearch.Candidate{
				ResultRef: candidate.result.ResultRef, SourceKind: candidate.result.SourceKind,
				NoticeID: candidate.result.NoticeID, DocumentID: candidate.result.DocumentID,
				Title:       campussearch.Bound(candidate.result.Title, 400),
				Section:     campussearch.Bound(candidate.result.SectionTitle, 400),
				FusionScore: point.Score, RetrievalRank: pointIndex + 1,
				Text: campussearch.Bound(candidate.result.Text, 160),
			})
			candidate.diagnostic = &snapshot.Candidates[len(snapshot.Candidates)-1]
		} else {
			snapshot.SnapshotTruncated = true
		}
		candidates = append(candidates, candidate)
	}
	if len(candidates) > campusDocsCandidateLimit {
		return nil, errors.New("campus docs Qdrant response exceeds the candidate limit")
	}
	snapshot.DeduplicatedCount = len(candidates)
	snapshot.RerankInputCount = len(candidates)
	snapshot.Durations["retrieval"] = time.Since(started).Milliseconds()
	if snapshot.Retrieval != nil {
		ms := time.Since(postprocessStarted).Milliseconds()
		snapshot.Retrieval.PostprocessMs = &ms
	}
	observer.Phase("retrieved")
	if len(candidates) == 0 {
		snapshot.Durations["selection"] = 0
		snapshot.FailedStage = ""
		observer.Phase("selected")
		return []searchapi.SearchResultItem{}, nil
	}
	started = time.Now()
	stage, snapshot.FailedStage = "rerank", "rerank"
	rerankerConfig, err := client.resolveRerankerProviderConfig(ctx)
	if err != nil {
		return nil, err
	}
	snapshot.Rerank = &campussearch.RerankMeta{Provider: rerankerConfig.Provider, Model: rerankerConfig.Model, InputCount: len(candidates)}
	rankedCandidates, err := client.rerankCampusDocsCandidates(ctx, rerankerConfig, rerankQuery, candidates)
	if err != nil {
		return nil, err
	}

	snapshot.RerankKeptCount = len(rankedCandidates)
	snapshot.Durations["rerank"] = time.Since(started).Milliseconds()
	observer.Phase("reranked")
	started = time.Now()
	stage, snapshot.FailedStage = "selection", "selection"
	// Different sections of one notice can answer different parts of the question.
	// Exclude previously returned evidence before allocating the result budget.
	excluded := make(map[string]bool, len(queries.ExcludedResultRefs))
	for _, ref := range queries.ExcludedResultRefs {
		excluded[ref] = true
	}
	snapshot.SourceGroupedCount = len(rankedCandidates)
	results := make([]searchapi.SearchResultItem, 0, resultLimit)
	characterCount := 0
	type sourceCap struct {
		noticeCount map[string]int
		sectionSeen map[string]bool
		deferred    []campusDocsCandidate
	}
	caps := &sourceCap{
		noticeCount: map[string]int{},
		sectionSeen: map[string]bool{},
	}
	// First pass: apply per-source diversity caps. A single notice or document
	// can occupy at most two result slots; the same section of the same source
	// can occupy at most one. This prevents multiple chunks from the same
	// notice's opening section from consuming the entire result budget.
	for _, candidate := range rankedCandidates {
		if excluded[candidate.result.ResultRef] {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "already_returned"
			}
			continue
		}
		if len(results) >= resultLimit {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "result_limit"
			}
			continue
		}
		sourceKey := candidate.result.SourceKind + "\x00"
		if candidate.result.SourceKind == "notice" {
			sourceKey += candidate.result.NoticeID
		} else {
			sourceKey += candidate.result.DocumentID
		}
		sectionKey := sourceKey + "\x00" + candidate.result.SectionTitle
		if caps.noticeCount[sourceKey] >= 2 {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "same_notice_cap"
			}
			caps.deferred = append(caps.deferred, candidate)
			continue
		}
		if caps.sectionSeen[sectionKey] {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "same_section_cap"
			}
			caps.deferred = append(caps.deferred, candidate)
			continue
		}
		textLength := utf8.RuneCountInString(candidate.result.Text)
		if characterCount+textLength > searchapi.EvidenceCharBudget {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "evidence_char_budget"
			}
			continue
		}
		caps.noticeCount[sourceKey]++
		caps.sectionSeen[sectionKey] = true
		if candidate.diagnostic != nil {
			candidate.diagnostic.Returned = true
			candidate.diagnostic.Text = candidate.result.Text
			citationIndex := snapshot.CitationStart + len(results)
			candidate.diagnostic.CitationIndex = &citationIndex
		}
		results = append(results, candidate.result)
		characterCount += textLength
	}
	// Second pass: backfill from diversity-capped candidates when the first
	// pass did not fill the result budget. This ensures the limit is only
	// reached when there genuinely are not enough distinct sources.
	for _, candidate := range caps.deferred {
		if len(results) >= resultLimit {
			break
		}
		textLength := utf8.RuneCountInString(candidate.result.Text)
		if characterCount+textLength > searchapi.EvidenceCharBudget {
			if candidate.diagnostic != nil {
				candidate.diagnostic.ExclusionReason = "evidence_char_budget"
			}
			continue
		}
		if candidate.diagnostic != nil {
			candidate.diagnostic.ExclusionReason = ""
			candidate.diagnostic.Returned = true
			candidate.diagnostic.Text = candidate.result.Text
			citationIndex := snapshot.CitationStart + len(results)
			candidate.diagnostic.CitationIndex = &citationIndex
		}
		results = append(results, candidate.result)
		characterCount += textLength
	}
	snapshot.SourceGroupedExcludedCount = len(caps.deferred)
	snapshot.ReturnedCount = len(results)
	snapshot.ExcludedCount = len(candidates) - len(results)
	snapshot.Durations["selection"] = time.Since(started).Milliseconds()
	snapshot.FailedStage = ""
	observer.Phase("selected")
	return results, nil
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
	goal string,
	embedding []float64,
	target campussearch.Index,
) ([]qdrantPoint, error) {
	if client == nil || client.httpClient == nil {
		return nil, errors.New("qdrant HTTP client is not configured")
	}
	if err := campussearch.ValidateIndex(target); err != nil {
		return nil, err
	}
	if err := validateCampusDocsEmbedding(embedding); err != nil {
		return nil, err
	}
	bodyPayload, err := campussearch.BuildHybridQueryBody(campussearch.HybridQuery{
		DenseEmbedding:   embedding,
		DenseVectorName:  campussearch.DenseVectorName,
		QueryText:        query,
		SparseVectorName: campussearch.SparseVectorName,
		TopK:             campusDocsCandidateLimit,
		Filter:           campussearch.BuildRetrievalFilter(campussearch.ResolveRetrievalScope(query, goal)),
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
	meta := campussearch.SearchObservation(ctx).Snapshot.Retrieval
	httpStarted := time.Now()
	defer func() {
		if meta != nil && meta.HTTPMs == nil {
			ms := time.Since(httpStarted).Milliseconds()
			meta.HTTPMs = &ms
		}
	}()
	response, err := NoRedirectHTTPClient(client.httpClient).Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if meta != nil {
		meta.HTTPStatus = &response.StatusCode
	}
	responseBody, err := io.ReadAll(response.Body)
	if meta != nil {
		ms := time.Since(httpStarted).Milliseconds()
		meta.HTTPMs = &ms
	}
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant query status %d", response.StatusCode)
	}
	decodeStarted := time.Now()
	defer func() {
		if meta != nil {
			ms := time.Since(decodeStarted).Milliseconds()
			meta.DecodeMs = &ms
		}
	}()
	return decodeCampusDocsQdrantQueryResponse(responseBody, meta)
}

func validateCampusDocsEmbedding(embedding []float64) error {
	if len(embedding) != campussearch.EmbeddingDimensions {
		return fmt.Errorf(
			"query embedding dimensions = %d, want %d",
			len(embedding),
			campussearch.EmbeddingDimensions,
		)
	}
	for index, value := range embedding {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return fmt.Errorf("embedding value %d is not finite", index)
		}
	}
	return nil
}

func decodeCampusDocsQdrantQueryResponse(responseBody []byte, meta *campussearch.RetrievalMeta) ([]qdrantPoint, error) {
	var payload struct {
		Time   json.RawMessage `json:"time"`
		Result *struct {
			Points *[]qdrantPointWire `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant query response: %w", err)
	}
	if meta != nil && len(payload.Time) > 0 && string(payload.Time) != "null" {
		var seconds float64
		if err := json.Unmarshal(payload.Time, &seconds); err == nil && seconds >= 0 && !math.IsInf(seconds*1000, 0) {
			ms := seconds * 1000
			meta.QdrantMs = &ms
		}
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
	index campussearch.Index,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	if err := campussearch.ValidateIndex(index); err != nil {
		return campusDocsCandidate{}, err
	}
	payload := point.Payload
	sourceKind := FirstNonEmptyText(payload["source_kind"])
	if sourceKind == "notice" {
		return campusNoticeCandidateFromQdrantPoint(index, point)
	}
	required := map[string]string{
		"schema_version":        FirstNonEmptyText(payload["schema_version"]),
		"chunk_id":              FirstNonEmptyText(payload["chunk_id"]),
		"section_ref":           FirstNonEmptyText(payload["section_ref"]),
		"document_id":           FirstNonEmptyText(payload["document_id"]),
		"document_title":        FirstNonEmptyText(payload["document_title"]),
		"section_title":         FirstNonEmptyText(payload["section_title"]),
		"text":                  FirstNonEmptyText(payload["text"]),
		"text_sha256":           FirstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": FirstNonEmptyText(payload["retrieval_text_sha256"]),
		"version_id":            FirstNonEmptyText(payload["version_id"]),
		"version_slug":          FirstNonEmptyText(payload["version_slug"]),
	}
	for field, value := range required {
		if value == "" {
			return campusDocsCandidate{}, fmt.Errorf("campus docs Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_docs_point.v3" && required["schema_version"] != "campus_rag_point.v1" && required["schema_version"] != "campus_rag_point.v2" && required["schema_version"] != "campus_rag_point.v3" {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload schema is unsupported")
	}
	if required["schema_version"] == "campus_rag_point.v2" || required["schema_version"] == "campus_rag_point.v3" {
		if FirstNonEmptyText(payload["corpus"]) == "" || payload["is_current"] == nil {
			return campusDocsCandidate{}, errors.New("campus docs Qdrant version routing payload is required")
		}
	}
	if !searchapi.ValidVersionSlug(required["version_slug"]) ||
		!searchapi.ValidVersionedSectionRef(required["section_ref"], required["version_slug"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload section_ref is invalid")
	}
	if !ValidSHA256Ref(required["text_sha256"]) ||
		SHA256TextRef(required["text"]) != required["text_sha256"] {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text hash is invalid")
	}
	if !ValidSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload retrieval text hash is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant score is invalid")
	}
	rootUnitIDs, ok := searchapi.DecodeRootUnitIDs(payload["root_unit_ids"])
	if !ok {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload root_unit_ids is invalid")
	}
	if textLength := utf8.RuneCountInString(required["text"]); textLength < 1 || textLength > searchapi.EvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("campus docs Qdrant payload text length is invalid")
	}
	dedupKey := strings.Join([]string{index.Collection, required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		dedupKey: dedupKey,
		result: searchapi.SearchResultItem{
			ResultRef:    "result://" + strings.TrimPrefix(SHA256TextRef(dedupKey), "sha256:"),
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
	index campussearch.Index,
	point qdrantPoint,
) (campusDocsCandidate, error) {
	payload := point.Payload
	required := map[string]string{
		"schema_version":        FirstNonEmptyText(payload["schema_version"]),
		"chunk_id":              FirstNonEmptyText(payload["chunk_id"]),
		"notice_id":             FirstNonEmptyText(payload["notice_id"]),
		"title":                 FirstNonEmptyText(payload["title"]),
		"section_title":         FirstNonEmptyText(payload["section_title"]),
		"citation_href":         FirstNonEmptyText(payload["citation_href"]),
		"text":                  FirstNonEmptyText(payload["text"]),
		"text_sha256":           FirstNonEmptyText(payload["text_sha256"]),
		"retrieval_text_sha256": FirstNonEmptyText(payload["retrieval_text_sha256"]),
	}
	for field, value := range required {
		if value == "" {
			return campusDocsCandidate{}, fmt.Errorf("campus notice Qdrant payload %s is required", field)
		}
	}
	if required["schema_version"] != "campus_rag_point.v1" && required["schema_version"] != "campus_rag_point.v2" && required["schema_version"] != "campus_rag_point.v3" {
		return campusDocsCandidate{}, fmt.Errorf("campus notice Qdrant payload schema %q is unsupported", required["schema_version"])
	}
	if !searchapi.ValidNoticeCitationHrefForNoticeID(required["citation_href"], required["notice_id"]) ||
		!ValidSHA256Ref(required["text_sha256"]) ||
		SHA256TextRef(required["text"]) != required["text_sha256"] ||
		!ValidSHA256Ref(required["retrieval_text_sha256"]) {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant payload is invalid")
	}
	if math.IsNaN(point.Score) || math.IsInf(point.Score, 0) {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant score is invalid")
	}
	if textLength := utf8.RuneCountInString(required["text"]); textLength < 1 || textLength > searchapi.EvidenceCharBudget {
		return campusDocsCandidate{}, errors.New("campus notice Qdrant payload text length is invalid")
	}
	releasedAt := FirstNonEmptyText(payload["released_at"])
	if required["schema_version"] == "campus_rag_point.v3" {
		parsed, err := time.Parse(time.RFC3339Nano, releasedAt)
		_, offset := parsed.Zone()
		if err != nil || offset != 0 {
			return campusDocsCandidate{}, errors.New("campus notice Qdrant payload released_at is invalid")
		}
	}
	dedupKey := strings.Join([]string{index.Collection, "notice", required["chunk_id"], required["text_sha256"]}, "\x00")
	return campusDocsCandidate{
		dedupKey: dedupKey,
		result: searchapi.SearchResultItem{
			CitationHref: required["citation_href"],
			NoticeID:     required["notice_id"],
			ReleasedAt:   releasedAt,
			ResultRef:    "result://" + strings.TrimPrefix(SHA256TextRef(dedupKey), "sha256:"),
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
	meta := campussearch.SearchObservation(ctx).Snapshot.Rerank
	httpStarted := time.Now()
	defer func() {
		if meta != nil && meta.HTTPMs == nil {
			ms := time.Since(httpStarted).Milliseconds()
			meta.HTTPMs = &ms
		}
	}()
	response, err := NoRedirectHTTPClient(client.rerankHTTPClient).Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if meta != nil {
		ms := time.Since(httpStarted).Milliseconds()
		meta.HTTPMs = &ms
	}
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
	for position, item := range ranked {
		if item.candidate.diagnostic != nil {
			score, rank := item.score, position+1
			item.candidate.diagnostic.RerankScore = &score
			item.candidate.diagnostic.RerankRank = &rank
		}
		if item.score < campusDocsRerankRelevanceThreshold {
			if item.candidate.diagnostic != nil {
				item.candidate.diagnostic.ExclusionReason = "rerank_below_threshold"
			}
			continue
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
