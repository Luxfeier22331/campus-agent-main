package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
)

const (
	publicWebSearchDefaultMaxResults = 5
	publicWebSearchMaxResults        = 5
)

var publicWebSearchDefaultDomains = []string{"muc.edu.cn"}

type publicWebSearchPayload struct {
	MaxResults *int   `json:"max_results"`
	QueryText  string `json:"query_text"`
}

type publicWebSearchProviderSource struct {
	Snippet string `json:"snippet"`
	Title   string `json:"title"`
	URL     string `json:"url"`
}

type publicWebSearchSource struct {
	ContentHash    *string `json:"content_hash"`
	EvidenceID     string  `json:"evidence_id"`
	PublisherLabel *string `json:"publisher_label"`
	Snippet        string  `json:"snippet"`
	SourceKind     string  `json:"source_kind"`
	TargetKind     string  `json:"target_kind"`
	Title          string  `json:"title"`
	URL            string  `json:"url"`
}

func (s *Server) handlePublicWebSearch(response http.ResponseWriter, request *http.Request) {
	tool := "public_web_search"
	if !s.toolReadModelAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid tool read model auth.", false)
		s.metrics.RecordToolReadModel(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	payload, err := parsePublicWebSearchPayload(body)
	if err != nil {
		setOutcome(response, "invalid_request")
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, statusCode, outcome := s.executePublicWebSearch(request.Context(), payload)
	setOutcome(response, outcome)
	s.metrics.RecordToolReadModel(tool, outcome, statusCode)
	writeJSON(response, statusCode, result)
}

func parsePublicWebSearchPayload(body json.RawMessage) (publicWebSearchPayload, error) {
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil || decoded == nil {
		return publicWebSearchPayload{}, fmt.Errorf("public_web_search payload is invalid")
	}
	return parsePublicWebSearchPayloadObject(decoded)
}

func parsePublicWebSearchPayloadObject(body map[string]any) (publicWebSearchPayload, error) {
	raw := body
	if nested, ok := body["payload"].(map[string]any); ok {
		raw = nested
	}
	var payload publicWebSearchPayload
	data, err := json.Marshal(raw)
	if err != nil {
		return payload, fmt.Errorf("public_web_search payload is invalid")
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return payload, fmt.Errorf("public_web_search payload is invalid")
	}
	payload.QueryText = strings.TrimSpace(payload.QueryText)
	if payload.QueryText == "" {
		return payload, fmt.Errorf("query_text is required")
	}
	if payload.MaxResults != nil && (*payload.MaxResults < 1 || *payload.MaxResults > publicWebSearchMaxResults) {
		return payload, fmt.Errorf("max_results must be between 1 and %d", publicWebSearchMaxResults)
	}
	return payload, nil
}

func (s *Server) executePublicWebSearch(
	ctx context.Context,
	payload publicWebSearchPayload,
) (map[string]any, int, string) {
	config, err := s.resolveProviderConfigSnapshot(ctx, providerConfigRolePublicWebSearch)
	if err != nil {
		return publicWebSearchFailure("public_web_search_provider_not_configured", err.Error()), http.StatusOK, "temporarily_unverifiable"
	}
	if err := validatePublicWebSearchProviderConfig(config); err != nil {
		return publicWebSearchFailure("public_web_search_provider_config_invalid", err.Error()), http.StatusOK, "temporarily_unverifiable"
	}
	timeout := time.Duration(config.TimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	searchCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	allowedDomains := s.publicWebSearchAllowedDomains()
	rawSources, err := s.executePublicWebSearchTransport(searchCtx, config, payload, allowedDomains)
	if err != nil {
		return publicWebSearchFailure("public_web_search_provider_failed", err.Error()), http.StatusOK, "temporarily_unverifiable"
	}
	sources, err := sanitizePublicWebSearchProviderSources(rawSources, maxResults(payload), allowedDomains)
	if err != nil {
		return publicWebSearchFailure("public_web_search_invalid_provider_output", err.Error()), http.StatusOK, "temporarily_unverifiable"
	}
	return map[string]any{
		"result_kind": "public_web_evidence",
		"query_text":  payload.QueryText,
		"provider":    config.Provider,
		"model":       config.Model,
		"sources":     sources,
	}, http.StatusOK, "resolved_current"
}

func (s *Server) executePublicWebSearchTransport(
	ctx context.Context,
	config providerConfigSnapshot,
	payload publicWebSearchPayload,
	allowedDomains []string,
) ([]publicWebSearchProviderSource, error) {
	switch strings.TrimSpace(config.Transport) {
	case "perplexity_search":
		client := provider.NewPerplexitySearchTransportClient(provider.PerplexitySearchTransportClientConfig{
			APIKey:        config.APIKey,
			BaseURL:       config.BaseURL,
			MaxResults:    maxResults(payload),
			ModelName:     config.Model,
			ModelProvider: config.Provider,
		})
		result := client.Execute(ctx, provider.PerplexitySearchRequest{
			DomainFilter:       allowedDomains,
			ProviderRequestRef: "provider://public-web-search",
			Query:              payload.QueryText,
		})
		if result.Err != nil {
			return nil, result.Err
		}
		return publicWebSearchProviderSourcesFromPerplexitySearchTransport(result.Results), nil
	case "openai_responses_web_search":
		client := provider.NewOpenAIWebSearchTransportClient(provider.OpenAIWebSearchTransportClientConfig{
			APIKey:        config.APIKey,
			BaseURL:       config.BaseURL,
			MaxResults:    maxResults(payload),
			ModelName:     config.Model,
			ModelProvider: config.Provider,
		})
		result := client.Execute(ctx, provider.OpenAIWebSearchRequest{
			DomainFilter:       allowedDomains,
			ProviderRequestRef: "provider://public-web-search",
			Query:              payload.QueryText,
		})
		if result.Err != nil {
			return nil, result.Err
		}
		return publicWebSearchProviderSourcesFromOpenAIWebSearchTransport(result.Results), nil
	case "gemini_google_search":
		client := provider.NewGeminiGoogleSearchTransportClient(provider.GeminiGoogleSearchTransportClientConfig{
			APIKey:        config.APIKey,
			BaseURL:       config.BaseURL,
			MaxResults:    maxResults(payload),
			ModelName:     config.Model,
			ModelProvider: config.Provider,
		})
		result := client.Execute(ctx, provider.GeminiGoogleSearchRequest{
			DomainFilter:       allowedDomains,
			ProviderRequestRef: "provider://public-web-search",
			Query:              payload.QueryText,
		})
		if result.Err != nil {
			return nil, result.Err
		}
		return publicWebSearchProviderSourcesFromGeminiGoogleSearchTransport(result.Results), nil
	case "openai_chat_completions_web_search":
		client := provider.NewOpenAIChatCompletionsWebSearchTransportClient(provider.OpenAIChatCompletionsWebSearchTransportClientConfig{
			APIKey:        config.APIKey,
			BaseURL:       config.BaseURL,
			MaxResults:    maxResults(payload),
			ModelName:     config.Model,
			ModelProvider: config.Provider,
		})
		result := client.Execute(ctx, provider.OpenAIChatCompletionsWebSearchRequest{
			DomainFilter:       allowedDomains,
			ProviderRequestRef: "provider://public-web-search",
			Query:              payload.QueryText,
		})
		if result.Err != nil {
			return nil, result.Err
		}
		return publicWebSearchProviderSourcesFromOpenAIChatCompletionsWebSearchTransport(result.Results), nil
	default:
		return nil, fmt.Errorf("public_web_search transport = %q is not admitted", config.Transport)
	}
}

func (s *Server) publicWebSearchAllowedDomains() []string {
	if len(s.publicWebSearchDomains) == 0 {
		return publicWebSearchDefaultDomains
	}
	domains := make([]string, 0, len(s.publicWebSearchDomains))
	seen := map[string]struct{}{}
	for _, domain := range s.publicWebSearchDomains {
		normalized := strings.ToLower(strings.TrimSpace(domain))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		domains = append(domains, normalized)
	}
	if len(domains) == 0 {
		return publicWebSearchDefaultDomains
	}
	return domains
}

func maxResults(payload publicWebSearchPayload) int {
	if payload.MaxResults == nil {
		return publicWebSearchDefaultMaxResults
	}
	if *payload.MaxResults > publicWebSearchMaxResults {
		return publicWebSearchMaxResults
	}
	return *payload.MaxResults
}

func validatePublicWebSearchProviderConfig(config providerConfigSnapshot) error {
	if strings.TrimSpace(config.Kind) != "search" {
		return fmt.Errorf("public_web_search provider kind = %q, want search", config.Kind)
	}
	if !publicWebSearchProviderAdmitted(config.Provider) {
		return fmt.Errorf("public_web_search provider = %q is not admitted", config.Provider)
	}
	if !publicWebSearchProviderTransportAdmitted(config.Provider, config.Transport) {
		return fmt.Errorf(
			"public_web_search provider/transport = %q/%q is not admitted",
			config.Provider,
			config.Transport,
		)
	}
	return nil
}

func publicWebSearchProviderAdmitted(providerName string) bool {
	switch strings.TrimSpace(providerName) {
	case "gemini", "linux_do", "openai", "perplexity", "perplexity_compatible":
		return true
	default:
		return false
	}
}

func publicWebSearchProviderTransportAdmitted(providerName string, transport string) bool {
	switch strings.TrimSpace(providerName) + "/" + strings.TrimSpace(transport) {
	case "gemini/gemini_google_search",
		"linux_do/openai_chat_completions_web_search",
		"openai/openai_responses_web_search",
		"perplexity/perplexity_search",
		"perplexity_compatible/perplexity_search":
		return true
	default:
		return false
	}
}

func publicWebSearchProviderSourcesFromPerplexitySearchTransport(
	results []provider.PerplexitySearchResult,
) []publicWebSearchProviderSource {
	sources := make([]publicWebSearchProviderSource, 0, len(results))
	for _, result := range results {
		sources = append(sources, publicWebSearchProviderSource{
			Snippet: result.Snippet,
			Title:   result.Title,
			URL:     result.URL,
		})
	}
	return sources
}

func publicWebSearchProviderSourcesFromOpenAIWebSearchTransport(
	results []provider.OpenAIWebSearchResult,
) []publicWebSearchProviderSource {
	sources := make([]publicWebSearchProviderSource, 0, len(results))
	for _, result := range results {
		sources = append(sources, publicWebSearchProviderSource{
			Snippet: result.Snippet,
			Title:   result.Title,
			URL:     result.URL,
		})
	}
	return sources
}

func publicWebSearchProviderSourcesFromGeminiGoogleSearchTransport(
	results []provider.GeminiGoogleSearchResult,
) []publicWebSearchProviderSource {
	sources := make([]publicWebSearchProviderSource, 0, len(results))
	for _, result := range results {
		sources = append(sources, publicWebSearchProviderSource{
			Snippet: result.Snippet,
			Title:   result.Title,
			URL:     result.URL,
		})
	}
	return sources
}

func publicWebSearchProviderSourcesFromOpenAIChatCompletionsWebSearchTransport(
	results []provider.OpenAIChatCompletionsWebSearchResult,
) []publicWebSearchProviderSource {
	sources := make([]publicWebSearchProviderSource, 0, len(results))
	for _, result := range results {
		sources = append(sources, publicWebSearchProviderSource{
			Snippet: result.Snippet,
			Title:   result.Title,
			URL:     result.URL,
		})
	}
	return sources
}

func sanitizePublicWebSearchProviderSources(
	rawSources []publicWebSearchProviderSource,
	limit int,
	allowedDomains []string,
) ([]publicWebSearchSource, error) {
	if len(rawSources) == 0 {
		return nil, errors.New("provider output contains no sources")
	}
	if len(rawSources) > limit {
		return nil, fmt.Errorf("provider output contains %d sources, limit is %d", len(rawSources), limit)
	}
	seen := map[string]struct{}{}
	sources := make([]publicWebSearchSource, 0, min(limit, len(rawSources)))
	for index, source := range rawSources {
		normalizedURL, err := normalizePublicWebURLForDomains(source.URL, allowedDomains)
		if err != nil {
			return nil, fmt.Errorf("provider sources[%d].url is invalid: %w", index, err)
		}
		if _, ok := seen[normalizedURL]; ok {
			return nil, fmt.Errorf("provider sources[%d].url is duplicated", index)
		}
		title := strings.TrimSpace(source.Title)
		snippet := strings.TrimSpace(source.Snippet)
		if title == "" || snippet == "" {
			return nil, fmt.Errorf("provider sources[%d] requires title and snippet", index)
		}
		seen[normalizedURL] = struct{}{}
		hash := publicWebContentHash(normalizedURL, snippet)
		sources = append(sources, publicWebSearchSource{
			ContentHash:    &hash,
			EvidenceID:     publicWebEvidenceID(normalizedURL, snippet),
			PublisherLabel: stringPtr("中央民族大学"),
			Snippet:        snippet,
			SourceKind:     "public_web",
			TargetKind:     "public_web_url",
			Title:          title,
			URL:            normalizedURL,
		})
	}
	return sources, nil
}

func normalizePublicWebURL(raw string) (string, error) {
	return normalizePublicWebURLForDomains(raw, publicWebSearchDefaultDomains)
}

func normalizePublicWebURLForDomains(raw string, allowedDomains []string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "https" {
		return "", errors.New("source url must use https")
	}
	if parsed.Port() != "" {
		return "", errors.New("source url must not include an explicit port")
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if !publicWebHostAllowed(host, allowedDomains) {
		return "", fmt.Errorf("source url host is not allowed: %s", host)
	}
	if host == "my.muc.edu.cn" {
		return "", errors.New("source url host is not public web")
	}
	parsed.Host = host
	query := parsed.Query()
	for key := range query {
		lower := strings.ToLower(key)
		if strings.HasPrefix(lower, "utm_") || lower == "spm" {
			query.Del(key)
		}
	}
	parsed.RawQuery = query.Encode()
	parsed.Fragment = ""
	return parsed.String(), nil
}

func publicWebHostAllowed(host string, allowedDomains []string) bool {
	for _, domain := range allowedDomains {
		normalized := strings.ToLower(strings.TrimSpace(domain))
		if normalized == "" {
			continue
		}
		if host == normalized || strings.HasSuffix(host, "."+normalized) {
			return true
		}
	}
	return false
}

func publicWebContentHash(url string, snippet string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(url) + "\n" + strings.TrimSpace(snippet)))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func publicWebEvidenceID(url string, snippet string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(url) + "\n" + strings.TrimSpace(snippet)))
	return "public_web:" + hex.EncodeToString(sum[:8])
}

func publicWebSearchFailure(reason string, detail string) map[string]any {
	return map[string]any{
		"outcome":           "temporarily_unverifiable",
		"fail_close_reason": reason,
		"error": map[string]any{
			"code":      reason,
			"message":   detail,
			"retryable": true,
		},
	}
}

func stringPtr(value string) *string {
	return &value
}
