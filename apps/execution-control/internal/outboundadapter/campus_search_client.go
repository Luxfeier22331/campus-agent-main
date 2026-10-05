package outboundadapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/campus-search/campussearch"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

type CampusSearchHTTPClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewCampusSearchHTTPClient(baseURL, token string, timeout time.Duration) (*CampusSearchHTTPClient, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" {
		return nil, errors.New("campus search service URL is required")
	}
	if token == "" {
		return nil, errors.New("campus search service token is required")
	}
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &CampusSearchHTTPClient{baseURL: baseURL, token: token, http: &http.Client{Timeout: timeout}}, nil
}

type campusSearchInternalResponse struct {
	Collection  string                 `json:"collection"`
	Outcome     string                 `json:"outcome"`
	Results     []map[string]any       `json:"results"`
	Diagnostics *campussearch.Snapshot `json:"diagnostics,omitempty"`
}

func (c *CampusSearchHTTPClient) Search(
	ctx context.Context,
	request executionapplication.CampusSearchClientRequest,
) (executionapplication.CampusSearchClientResponse, error) {
	if c == nil || c.http == nil {
		return executionapplication.CampusSearchClientResponse{}, errors.New("campus search service client is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"query":               strings.TrimSpace(request.RetrievalQuery),
		"search_goal":         strings.TrimSpace(request.RerankQuery),
		"exclude_result_refs": request.ExcludedResultRefs,
		"result_limit":        request.ResultLimit,
	})
	if err != nil {
		return executionapplication.CampusSearchClientResponse{}, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/v1/search", bytes.NewReader(body))
	if err != nil {
		return executionapplication.CampusSearchClientResponse{}, err
	}
	httpRequest.Header.Set("authorization", "Bearer "+c.token)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := c.http.Do(httpRequest)
	if err != nil {
		return executionapplication.CampusSearchClientResponse{}, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return executionapplication.CampusSearchClientResponse{}, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure campussearch.SearchErrorResponse
		if err := json.Unmarshal(raw, &failure); err != nil {
			return executionapplication.CampusSearchClientResponse{}, fmt.Errorf("campus search service returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(raw)))
		}
		cause := errors.New(failure.Error.Message)
		switch failure.Error.Code {
		case "campus_search_unavailable":
			cause = executionapplication.ErrCampusSearchUnavailable
		case "campus_search_timeout":
			cause = context.DeadlineExceeded
		}
		return executionapplication.CampusSearchClientResponse{}, &executionapplication.CampusSearchClientError{
			Cause: cause, Diagnostics: failure.Diagnostics,
		}
	}

	var decoded campusSearchInternalResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return executionapplication.CampusSearchClientResponse{}, fmt.Errorf("decode campus search response: %w", err)
	}
	resultMap := map[string]any{"outcome": decoded.Outcome, "results": decoded.Results}
	_, results, err := campussearch.DecodeSearchResult(resultMap)
	if err != nil {
		return executionapplication.CampusSearchClientResponse{}, err
	}
	return executionapplication.CampusSearchClientResponse{Collection: decoded.Collection, Results: results, Diagnostics: decoded.Diagnostics}, nil
}
