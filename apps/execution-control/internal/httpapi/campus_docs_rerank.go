package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/modelconfigclient"
)

const (
	campusDocsRerankRelevanceThreshold = 0.5
)

type campusDocsRerankResultWire struct {
	Index          *int     `json:"index"`
	RelevanceScore *float64 `json:"relevance_score"`
}

func (e campusDocsQdrantClient) rerankCampusDocsCandidates(
	ctx context.Context,
	provider modelconfigclient.RuntimeConfig,
	query string,
	candidates []campusDocsCandidate,
) ([]campusDocsCandidate, error) {
	if len(candidates) == 0 {
		return []campusDocsCandidate{}, nil
	}
	if e.rerankHTTPClient == nil {
		return nil, errors.New("reranker HTTP client is not configured")
	}
	baseURL, err := modelconfigclient.NormalizeBaseURL(provider.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("reranker provider base url: %w", err)
	}
	documents := make([]string, len(candidates))
	for index, candidate := range candidates {
		documents[index] = campusDocsRerankDocument(candidate)
	}
	body, err := json.Marshal(map[string]any{
		"documents": documents,
		"model":     provider.Model,
		"query":     strings.TrimSpace(query),
	})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		baseURL+"/rerank",
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, err
	}
	request.Header.Set("accept", "application/json")
	request.Header.Set("authorization", "Bearer "+provider.APIKey)
	request.Header.Set("content-type", "application/json")
	if provider.Provider == "cohere-compatible" {
		request.Header.Set("X-Failover-Enabled", "true")
	}
	response, err := noRedirectHTTPClient(e.rerankHTTPClient).Do(request)
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

func campusDocsRerankDocument(candidate campusDocsCandidate) string {
	return strings.Join([]string{
		strings.TrimSpace(candidate.result.Title),
		strings.TrimSpace(candidate.result.SectionTitle),
		strings.TrimSpace(candidate.result.Text),
	}, "\n")
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
