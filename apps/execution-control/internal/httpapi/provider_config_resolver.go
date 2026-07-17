package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type providerConfigRole string

const (
	providerConfigRolePrimaryAgent      providerConfigRole = "primary_agent"
	providerConfigRoleRAGQueryEmbedding providerConfigRole = "rag_query_embedding"
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

type postgresProviderConfigResolver struct{ store *providerconfig.Store }

var errProviderConfigResolverNotConfigured = errors.New("provider config resolver is not configured")

func newProviderConfigResolver(cfg config.Config) (providerConfigResolver, error) {
	if strings.TrimSpace(cfg.ProviderConfigReaderDatabaseURL) == "" || strings.TrimSpace(cfg.ProviderConfigKeyringPath) == "" {
		return nil, errProviderConfigResolverNotConfigured
	}
	keyring, err := providerconfig.LoadKeyring(cfg.ProviderConfigKeyringPath)
	if err != nil {
		return nil, err
	}
	store, err := providerconfig.NewStore(context.Background(), cfg.ProviderConfigReaderDatabaseURL, keyring)
	if err != nil {
		return nil, err
	}
	return postgresProviderConfigResolver{store: store}, nil
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

func (resolver postgresProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	role providerConfigRole,
) (providerConfigSnapshot, error) {
	if resolver.store == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	resolved, err := resolver.store.Resolve(ctx, providerconfig.Role(role))
	if err != nil {
		return providerConfigSnapshot{}, err
	}
	snapshot := providerConfigSnapshot{APIKey: resolved.APIKey, BaseURL: resolved.BaseURL, ToolConfig: resolved.ToolConfig, Dimensions: resolved.Dimensions, Kind: resolved.Kind, Model: resolved.Model, ProfileID: resolved.ProfileID, Provider: resolved.Provider, Revision: int(resolved.Revision), Role: resolved.Role, TimeoutMS: resolved.TimeoutMS, Transport: resolved.Transport}
	if err := validateProviderConfigSnapshot(snapshot, role); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}

func (resolver postgresProviderConfigResolver) Close()                       { resolver.store.Close() }
func (resolver postgresProviderConfigResolver) Store() *providerconfig.Store { return resolver.store }

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
	return nil
}

func isEmbeddingProviderConfigRole(role providerConfigRole) bool {
	switch role {
	case providerConfigRoleRAGQueryEmbedding:
		return true
	default:
		return false
	}
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
