package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

func (e qdrantKnowledgeSearchExecutor) rerankPoints(
	ctx context.Context,
	queryText string,
	points []qdrantPoint,
) ([]qdrantPoint, error) {
	if len(points) == 0 {
		return points, nil
	}
	if e.embeddingHTTPClient == nil {
		return nil, errors.New("reranker_failed: rerank HTTP client is not configured")
	}
	rerankConfig, err := e.resolveRerankProviderConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("reranker_failed: %w", err)
	}
	path := rerankPathFromProviderConfig(rerankConfig)
	if path == "" {
		return nil, errors.New("reranker_failed: rerank tool path is not configured")
	}
	documents := make([]string, 0, len(points))
	for _, point := range points {
		text := qdrantPointText(point)
		if strings.TrimSpace(text) == "" {
			return nil, errors.New("reranker_failed: qdrant candidate is missing rerankable text")
		}
		documents = append(documents, text)
	}
	body, err := json.Marshal(map[string]any{
		"documents": documents,
		"model":     rerankConfig.Model,
		"query":     strings.TrimSpace(queryText),
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		strings.TrimRight(rerankConfig.BaseURL, "/")+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "Bearer "+rerankConfig.APIKey)
	request.Header.Set("content-type", "application/json")
	response, err := e.embeddingHTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("reranker_failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("reranker_failed: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("reranker_failed: provider status %d", response.StatusCode)
	}
	scores, err := parseRerankScores(responseBody, len(points))
	if err != nil {
		return nil, fmt.Errorf("reranker_failed: %w", err)
	}
	ranked := make([]qdrantPoint, 0, len(points))
	for index, point := range points {
		point.Score = scores[index]
		ranked = append(ranked, point)
	}
	sort.SliceStable(ranked, func(left int, right int) bool {
		return ranked[left].Score > ranked[right].Score
	})
	return ranked, nil
}

func (e qdrantKnowledgeSearchExecutor) resolveRerankProviderConfig(
	ctx context.Context,
) (providerConfigSnapshot, error) {
	if e.configResolver == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	return e.configResolver.ResolveActiveProviderConfig(ctx, providerConfigRoleRAGReranker)
}

func rerankPathFromProviderConfig(snapshot providerConfigSnapshot) string {
	rerank, ok := snapshot.ToolConfig["rerank"].(map[string]any)
	if !ok {
		return ""
	}
	path, ok := rerank["path"].(string)
	if !ok {
		return ""
	}
	normalized := strings.TrimSpace(path)
	if !strings.HasPrefix(normalized, "/") {
		return ""
	}
	return normalized
}

func parseRerankScores(body []byte, candidateCount int) (map[int]float64, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("parse rerank response: %w", err)
	}
	results, ok := payload["results"].([]any)
	if !ok {
		results, ok = payload["data"].([]any)
	}
	if !ok || len(results) == 0 {
		return nil, errors.New("rerank response did not include results")
	}
	scores := make(map[int]float64, len(results))
	for _, item := range results {
		record, ok := item.(map[string]any)
		if !ok {
			return nil, errors.New("rerank result must be an object")
		}
		index, ok := intFieldFromRerankResult(record, "index")
		if !ok {
			index, ok = intFieldFromRerankResult(record, "document_index")
		}
		if !ok || index < 0 || index >= candidateCount {
			return nil, errors.New("rerank result index is invalid")
		}
		score, ok := floatFieldFromRerankResult(record, "relevance_score")
		if !ok {
			score, ok = floatFieldFromRerankResult(record, "score")
		}
		if !ok {
			return nil, errors.New("rerank result score is missing")
		}
		if _, exists := scores[index]; exists {
			return nil, errors.New("rerank result index is duplicated")
		}
		scores[index] = score
	}
	if len(scores) != candidateCount {
		return nil, errors.New("rerank response must score every candidate")
	}
	return scores, nil
}

func intFieldFromRerankResult(record map[string]any, key string) (int, bool) {
	value, ok := record[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		index := int(typed)
		return index, typed == float64(index)
	case int:
		return typed, true
	default:
		return 0, false
	}
}

func floatFieldFromRerankResult(record map[string]any, key string) (float64, bool) {
	value, ok := record[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	default:
		return 0, false
	}
}
