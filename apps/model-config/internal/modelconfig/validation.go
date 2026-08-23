package modelconfig

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
	"time"
)

const embeddingModel = "Qwen3-Embedding-4B"
const embeddingDimensions = 2560
const rerankAPIProtocol = "cohere.rerank"
const maxDiscoveredModels = 500

func Validate(ctx context.Context, target Target, apiKey string) Validation {
	if err := validateShape(target, apiKey); err != nil {
		return Validation{Status: "failed", ErrorCode: "invalid_setting", Message: err.Error()}
	}
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var endpoint string
	var body any
	switch target.APIProtocol {
	case "openai.responses":
		endpoint = target.BaseURL + "/responses"
		body = map[string]any{
			"model":             target.Model,
			"input":             "model-config validation",
			"max_output_tokens": 1,
		}
	case "openai.chat_completions":
		endpoint = target.BaseURL + "/chat/completions"
		body = map[string]any{"model": target.Model, "messages": []map[string]string{{"role": "user", "content": "model-config validation"}}, "max_tokens": 1}
	case "openai.embeddings":
		endpoint = target.BaseURL + "/embeddings"
		body = map[string]any{
			"model":      target.Model,
			"input":      []string{"model-config validation"},
			"dimensions": embeddingDimensions,
		}
	case rerankAPIProtocol:
		endpoint = target.BaseURL + "/rerank"
		body = map[string]any{
			"documents": []string{"model-config validation document"},
			"model":     target.Model,
			"query":     "model-config validation",
		}
	default:
		return Validation{Status: "failed", ErrorCode: "invalid_protocol", Message: "unsupported api_protocol"}
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "request_build_failed", Message: err.Error()}
	}
	req.Header.Set("authorization", "Bearer "+apiKey)
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return Validation{Status: "failed", ErrorCode: "provider_unavailable", Message: "model provider request failed"}
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Validation{Status: "failed", ErrorCode: fmt.Sprintf("provider_http_%d", resp.StatusCode), Message: "model provider rejected validation"}
	}
	if target.APIProtocol == "openai.embeddings" {
		var decoded struct {
			Data []struct {
				Embedding []float64 `json:"embedding"`
			} `json:"data"`
		}
		if json.Unmarshal(raw, &decoded) != nil || len(decoded.Data) == 0 {
			return Validation{Status: "failed", ErrorCode: "invalid_provider_response", Message: "embedding provider response is invalid"}
		}
		if len(decoded.Data[0].Embedding) != embeddingDimensions {
			return Validation{Status: "failed", ErrorCode: "embedding_dimensions_mismatch", Message: fmt.Sprintf("embedding dimensions = %d, want %d", len(decoded.Data[0].Embedding), embeddingDimensions), ObservedDimensions: len(decoded.Data[0].Embedding)}
		}
		return Validation{Status: "passed", Message: "model provider validation passed", ObservedDimensions: embeddingDimensions}
	}
	if target.APIProtocol == rerankAPIProtocol {
		var decoded struct {
			Results []struct {
				Index          *int     `json:"index"`
				RelevanceScore *float64 `json:"relevance_score"`
			} `json:"results"`
		}
		if json.Unmarshal(raw, &decoded) != nil ||
			len(decoded.Results) != 1 ||
			decoded.Results[0].Index == nil ||
			*decoded.Results[0].Index != 0 ||
			decoded.Results[0].RelevanceScore == nil ||
			math.IsNaN(*decoded.Results[0].RelevanceScore) ||
			math.IsInf(*decoded.Results[0].RelevanceScore, 0) {
			return Validation{Status: "failed", ErrorCode: "invalid_provider_response", Message: "rerank provider response is invalid"}
		}
	}
	return Validation{Status: "passed", Message: "model provider validation passed"}
}

func DiscoverModels(ctx context.Context, name ConfigName, provider, baseURL, apiKey string) ([]string, Validation) {
	provider = strings.TrimSpace(provider)
	normalized, err := NormalizeBaseURL(baseURL)
	if err != nil || !discoveryProviderAllowed(name, provider) || strings.TrimSpace(apiKey) == "" {
		message := "provider, base_url and api_key are required"
		if err != nil {
			message = err.Error()
		}
		return nil, Validation{Status: "failed", ErrorCode: "invalid_setting", Message: message}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, normalized+"/models", nil)
	if err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "request_build_failed", Message: "model discovery request is invalid"}
	}
	req.Header.Set("authorization", "Bearer "+apiKey)
	req.Header.Set("accept", "application/json")
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "provider_unavailable", Message: "model provider request failed"}
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, Validation{Status: "failed", ErrorCode: fmt.Sprintf("provider_http_%d", resp.StatusCode), Message: "model provider rejected discovery"}
	}
	var decoded struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
	}
	var items []string
	switch provider {
	case "cohere", "cohere-compatible":
		if decoded.Models == nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
		}
		items = make([]string, 0, len(decoded.Models))
		for _, item := range decoded.Models {
			items = append(items, item.Name)
		}
	default:
		if decoded.Data == nil {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response is invalid"}
		}
		items = make([]string, 0, len(decoded.Data))
		for _, item := range decoded.Data {
			items = append(items, item.ID)
		}
	}
	unique := make(map[string]struct{}, len(items))
	for _, rawID := range items {
		id := strings.TrimSpace(rawID)
		if id == "" || len(id) > 256 {
			return nil, Validation{Status: "failed", ErrorCode: "invalid_response", Message: "provider model response contains an invalid id"}
		}
		unique[id] = struct{}{}
	}
	models := make([]string, 0, len(unique))
	for id := range unique {
		models = append(models, id)
	}
	sort.Strings(models)
	if len(models) > maxDiscoveredModels {
		models = models[:maxDiscoveredModels]
	}
	return models, Validation{Status: "passed", Message: "provider model discovery passed"}
}

func discoveryProviderAllowed(name ConfigName, provider string) bool {
	switch name {
	case ConfigPrimaryAgent, ConfigNoticeClassification:
		return provider == "openai" || provider == "openai-compatible"
	case ConfigCampusDocsReranker:
		return provider == "cohere" || provider == "cohere-compatible"
	default:
		return false
	}
}

func validateShape(target Target, apiKey string) error {
	if target.Name == "" || target.Provider == "" || target.APIProtocol == "" || target.BaseURL == "" || target.Model == "" || strings.TrimSpace(apiKey) == "" {
		return errors.New("name, provider, api_protocol, base_url, model and api_key are required")
	}
	if target.Name != ConfigPrimaryAgent && target.Name != ConfigCampusDocsEmbedding && target.Name != ConfigCampusDocsReranker && target.Name != ConfigNoticeClassification {
		return errors.New("name is invalid")
	}
	if target.Name == ConfigCampusDocsEmbedding && (target.Provider != "openai-compatible" || target.APIProtocol != "openai.embeddings" || target.Model != embeddingModel) {
		return errors.New("embedding target is fixed by the Campus Docs contract")
	}
	if target.Name == ConfigCampusDocsReranker {
		if (target.Provider != "cohere" && target.Provider != "cohere-compatible") || target.APIProtocol != rerankAPIProtocol {
			return errors.New("reranker target is fixed by the Campus Docs contract")
		}
		return nil
	}
	if target.Provider != "openai" && target.Provider != "openai-compatible" {
		return errors.New("provider is invalid")
	}
	if target.Name != ConfigCampusDocsEmbedding && target.APIProtocol != "openai.responses" && target.APIProtocol != "openai.chat_completions" {
		return errors.New("text target api_protocol is invalid")
	}
	return nil
}
