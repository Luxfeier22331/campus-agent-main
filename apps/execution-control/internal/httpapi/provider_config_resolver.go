package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type providerConfigRole string

const (
	providerConfigRoleIndexEmbedding    providerConfigRole = "index_embedding"
	providerConfigRolePrimaryAgent      providerConfigRole = "primary_agent"
	providerConfigRoleRAGSynthesis      providerConfigRole = "rag_synthesis"
	providerConfigRoleRAGQueryEmbedding providerConfigRole = "rag_query_embedding"
	providerConfigRoleRAGReranker       providerConfigRole = "rag_reranker"
)

type providerConfigSnapshot struct {
	APIKey           string         `json:"api_key"`
	BaseURL          string         `json:"base_url"`
	CapabilityConfig map[string]any `json:"capability_config,omitempty"`
	Dimensions       int            `json:"dimensions,omitempty"`
	Kind             string         `json:"kind"`
	Model            string         `json:"model"`
	ProfileID        string         `json:"profile_id"`
	Provider         string         `json:"provider"`
	Revision         int            `json:"revision"`
	Role             string         `json:"role"`
	TimeoutMS        int            `json:"timeout_ms"`
	Transport        string         `json:"transport"`
}

type providerConfigResolver interface {
	ResolveActiveProviderConfig(context.Context, providerConfigRole) (providerConfigSnapshot, error)
}

type staticProviderConfigResolverForRole struct {
	role     providerConfigRole
	snapshot providerConfigSnapshot
}

type appAPIProviderConfigResolver struct {
	baseURL      string
	httpClient   *http.Client
	sharedSecret string
	timeout      time.Duration
}

var errProviderConfigResolverNotConfigured = errors.New("provider config resolver is not configured")

func newProviderConfigResolver(cfg config.Config) (providerConfigResolver, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.AppAPIInternalBaseURL), "/")
	sharedSecret := strings.TrimSpace(cfg.AppAPIInternalSharedSecret)
	if baseURL == "" && sharedSecret == "" {
		return nil, errProviderConfigResolverNotConfigured
	}
	if baseURL == "" || sharedSecret == "" {
		return nil, errors.New("EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL and EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET are required together")
	}
	parsed, err := url.ParseRequestURI(baseURL)
	if err != nil {
		return nil, fmt.Errorf("EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL must be a valid URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL must use http or https")
	}
	timeout := time.Duration(cfg.AppAPIInternalTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = time.Second
	}
	return appAPIProviderConfigResolver{
		baseURL:      baseURL,
		httpClient:   &http.Client{Timeout: timeout},
		sharedSecret: sharedSecret,
		timeout:      timeout,
	}, nil
}

func newStaticEmbeddingProviderConfigResolver(
	cfg config.Config,
	role providerConfigRole,
) (providerConfigResolver, error) {
	snapshot := providerConfigSnapshot{
		APIKey:     strings.TrimSpace(cfg.EmbeddingAPIKey),
		BaseURL:    staticEmbeddingBaseURL(cfg),
		Dimensions: cfg.EmbeddingDimensions,
		Kind:       "embedding",
		Model:      strings.TrimSpace(cfg.EmbeddingModel),
		ProfileID:  "static_embedding_config",
		Provider:   firstNonEmptyText(cfg.EmbeddingProvider, "openai-compatible"),
		Revision:   1,
		Role:       string(role),
		TimeoutMS:  int(time.Duration(cfg.QdrantTimeoutSeconds*float64(time.Second)) / time.Millisecond),
		Transport:  "embeddings",
	}
	if snapshot.TimeoutMS <= 0 {
		snapshot.TimeoutMS = 10000
	}
	if err := validateProviderConfigSnapshot(snapshot, role); err != nil {
		return nil, err
	}
	return staticProviderConfigResolverForRole{role: role, snapshot: snapshot}, nil
}

func (resolver staticProviderConfigResolverForRole) ResolveActiveProviderConfig(
	_ context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	if role != resolver.role {
		return providerConfigSnapshot{}, fmt.Errorf("static provider config role = %q, want %q", resolver.role, role)
	}
	if err := validateProviderConfigSnapshot(resolver.snapshot, role); err != nil {
		return providerConfigSnapshot{}, err
	}
	return resolver.snapshot, nil
}

func staticEmbeddingBaseURL(cfg config.Config) string {
	embeddingBaseURL := strings.TrimRight(strings.TrimSpace(cfg.EmbeddingBaseURL), "/")
	if embeddingBaseURL != "" {
		return embeddingBaseURL
	}
	return ""
}

func (resolver appAPIProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	if strings.TrimSpace(resolver.baseURL) == "" ||
		strings.TrimSpace(resolver.sharedSecret) == "" ||
		resolver.httpClient == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	normalizedRole := strings.TrimSpace(string(role))
	if normalizedRole == "" {
		return providerConfigSnapshot{}, errors.New("provider config role is required")
	}
	requestCtx, cancel := context.WithTimeout(ctx, resolver.timeout)
	defer cancel()
	endpoint := resolver.baseURL + "/api/internal/provider-config/active?role=" + url.QueryEscape(normalizedRole)
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return providerConfigSnapshot{}, err
	}
	request.Header.Set("x-app-internal-auth", resolver.sharedSecret)
	response, err := resolver.httpClient.Do(request)
	if err != nil {
		return providerConfigSnapshot{}, err
	}
	defer func() { _ = response.Body.Close() }()
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Profile providerConfigSnapshot `json:"profile"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return providerConfigSnapshot{}, fmt.Errorf("decode provider config snapshot: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(payload.Error.Message)
		if message == "" {
			message = fmt.Sprintf("provider config endpoint returned HTTP %d", response.StatusCode)
		}
		code := strings.TrimSpace(payload.Error.Code)
		if code != "" {
			return providerConfigSnapshot{}, fmt.Errorf("%s: %s", code, message)
		}
		return providerConfigSnapshot{}, errors.New(message)
	}
	if err := validateProviderConfigSnapshot(payload.Profile, role); err != nil {
		return providerConfigSnapshot{}, err
	}
	return payload.Profile, nil
}

func validateProviderConfigSnapshot(snapshot providerConfigSnapshot, role providerConfigRole) error {
	required := []struct {
		name  string
		value string
	}{
		{"api_key", snapshot.APIKey},
		{"base_url", snapshot.BaseURL},
		{"model", snapshot.Model},
		{"profile_id", snapshot.ProfileID},
		{"provider", snapshot.Provider},
		{"role", snapshot.Role},
		{"transport", snapshot.Transport},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("provider config snapshot %s is required", item.name)
		}
	}
	if snapshot.Role != string(role) {
		return fmt.Errorf("provider config snapshot role = %q, want %q", snapshot.Role, role)
	}
	if snapshot.Revision <= 0 {
		return errors.New("provider config snapshot revision is required")
	}
	if snapshot.TimeoutMS <= 0 {
		return errors.New("provider config snapshot timeout_ms is required")
	}
	if isEmbeddingProviderConfigRole(role) && snapshot.Dimensions <= 0 {
		return errors.New("embedding provider config snapshot dimensions is required")
	}
	if isRerankProviderConfigRole(role) && strings.TrimSpace(snapshot.Kind) != "rerank" {
		return errors.New("rerank provider config snapshot kind must be rerank")
	}
	return nil
}

func isEmbeddingProviderConfigRole(role providerConfigRole) bool {
	switch role {
	case providerConfigRoleIndexEmbedding, providerConfigRoleRAGQueryEmbedding:
		return true
	default:
		return false
	}
}

func isRerankProviderConfigRole(role providerConfigRole) bool {
	return role == providerConfigRoleRAGReranker
}

func (s *Server) resolveProviderConfigSnapshot(
	ctx context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	if s.providerConfigErr != nil && !errors.Is(s.providerConfigErr, errProviderConfigResolverNotConfigured) {
		return providerConfigSnapshot{}, s.providerConfigErr
	}
	if s.providerConfigResolver == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	return s.providerConfigResolver.ResolveActiveProviderConfig(ctx, role)
}
