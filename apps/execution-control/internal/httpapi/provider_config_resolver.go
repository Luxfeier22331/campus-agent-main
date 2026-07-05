package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type providerConfigRole string

const (
	providerConfigRoleIndexEmbedding    providerConfigRole = "index_embedding"
	providerConfigRolePrimaryAgent      providerConfigRole = "primary_agent"
	providerConfigRolePublicWebSearch   providerConfigRole = "public_web_search"
	providerConfigRoleRAGSynthesis      providerConfigRole = "rag_synthesis"
	providerConfigRoleRAGQueryEmbedding providerConfigRole = "rag_query_embedding"
	providerConfigRoleRAGReranker       providerConfigRole = "rag_reranker"
)

type providerConfigSnapshot struct {
	APIKey     string         `json:"api_key"`
	BaseURL    string         `json:"base_url"`
	ToolConfig map[string]any `json:"tool_config,omitempty"`
	Dimensions int            `json:"dimensions,omitempty"`
	Kind       string         `json:"kind"`
	Model      string         `json:"model"`
	ProfileID  string         `json:"profile_id"`
	Provider   string         `json:"provider"`
	Revision   int            `json:"revision"`
	Role       string         `json:"role"`
	TimeoutMS  int            `json:"timeout_ms"`
	Transport  string         `json:"transport"`
}

type providerConfigResolver interface {
	ResolveActiveProviderConfig(context.Context, providerConfigRole) (providerConfigSnapshot, error)
}

type staticProviderConfigResolverForRole struct {
	role     providerConfigRole
	snapshot providerConfigSnapshot
}

type fileProviderConfigResolver struct {
	path string
}

var errProviderConfigResolverNotConfigured = errors.New("provider config resolver is not configured")

func newProviderConfigResolver(cfg config.Config) (providerConfigResolver, error) {
	path := strings.TrimSpace(cfg.ProviderConfigSnapshotPath)
	if path == "" {
		return nil, errProviderConfigResolverNotConfigured
	}
	return fileProviderConfigResolver{path: path}, nil
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

func (resolver fileProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	_ = ctx
	if strings.TrimSpace(resolver.path) == "" {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	normalizedRole := strings.TrimSpace(string(role))
	if normalizedRole == "" {
		return providerConfigSnapshot{}, errors.New("provider config role is required")
	}
	if err := requireSecureProviderConfigProjectionFile(resolver.path); err != nil {
		return providerConfigSnapshot{}, err
	}
	data, err := os.ReadFile(resolver.path)
	if err != nil {
		return providerConfigSnapshot{}, fmt.Errorf("read provider config projection: %w", err)
	}
	var payload struct {
		SchemaVersion string                            `json:"schema_version"`
		Profiles      map[string]providerConfigSnapshot `json:"profiles"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return providerConfigSnapshot{}, fmt.Errorf("decode provider config projection: %w", err)
	}
	if payload.SchemaVersion != "provider_config_projection.v1" {
		return providerConfigSnapshot{}, errors.New("provider config projection schema_version is unsupported")
	}
	snapshot, ok := payload.Profiles[normalizedRole]
	if !ok {
		return providerConfigSnapshot{}, fmt.Errorf("provider config projection missing active role %s", normalizedRole)
	}
	if err := validateProviderConfigSnapshot(snapshot, role); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}

func requireSecureProviderConfigProjectionFile(path string) error {
	return requireSecureSecretProjectionFile(path, "provider config projection")
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
	if role == providerConfigRolePublicWebSearch {
		if strings.TrimSpace(snapshot.Kind) != "search" {
			return errors.New("public_web_search provider config snapshot kind must be search")
		}
		if !publicWebSearchProviderAdmitted(snapshot.Provider) {
			return errors.New("public_web_search provider config snapshot provider is not admitted")
		}
		if !publicWebSearchProviderTransportAdmitted(snapshot.Provider, snapshot.Transport) {
			return errors.New("public_web_search provider config snapshot provider/transport pair is not admitted")
		}
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
