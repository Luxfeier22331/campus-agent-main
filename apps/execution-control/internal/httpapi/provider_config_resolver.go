package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type providerConfigKind string

const (
	providerConfigKindLLM       providerConfigKind = "llm"
	providerConfigKindEmbedding providerConfigKind = "embedding"
)

type providerConfigSnapshot struct {
	APIKey     string             `json:"api_key"`
	BaseURL    string             `json:"base_url"`
	Dimensions int                `json:"dimensions,omitempty"`
	Kind       providerConfigKind `json:"kind"`
	Model      string             `json:"model"`
	Provider   string             `json:"provider"`
	Transport  string             `json:"transport"`
}

type providerConfigResolver interface {
	ResolveActiveProviderConfig(context.Context, providerConfigKind) (providerConfigSnapshot, error)
}

type staticProviderConfigResolverForKind struct {
	kind     providerConfigKind
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

func (resolver staticProviderConfigResolverForKind) ResolveActiveProviderConfig(
	_ context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	if kind != resolver.kind {
		return providerConfigSnapshot{}, fmt.Errorf("static provider config kind = %q, want %q", resolver.kind, kind)
	}
	if err := validateProviderConfigSnapshot(resolver.snapshot, kind); err != nil {
		return providerConfigSnapshot{}, err
	}
	return resolver.snapshot, nil
}

func (resolver postgresProviderConfigResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	if resolver.store == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	resolved, err := resolver.store.Resolve(ctx, providerconfig.Kind(kind))
	if err != nil {
		return providerConfigSnapshot{}, err
	}
	snapshot := providerConfigSnapshot{
		APIKey:     resolved.APIKey,
		BaseURL:    resolved.BaseURL,
		Dimensions: resolved.Dimensions,
		Kind:       providerConfigKind(resolved.Kind),
		Model:      resolved.Model,
		Provider:   resolved.Provider,
		Transport:  resolved.Transport,
	}
	if err := validateProviderConfigSnapshot(snapshot, kind); err != nil {
		return providerConfigSnapshot{}, err
	}
	return snapshot, nil
}

func (resolver postgresProviderConfigResolver) Close()                       { resolver.store.Close() }
func (resolver postgresProviderConfigResolver) Store() *providerconfig.Store { return resolver.store }

func validateProviderConfigSnapshot(snapshot providerConfigSnapshot, kind providerConfigKind) error {
	required := []struct {
		name  string
		value string
	}{
		{"api_key", snapshot.APIKey},
		{"base_url", snapshot.BaseURL},
		{"model", snapshot.Model},
		{"provider", snapshot.Provider},
		{"transport", snapshot.Transport},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("provider config snapshot %s is required", item.name)
		}
	}
	if snapshot.Kind != kind {
		return fmt.Errorf("provider config snapshot kind = %q, want %q", snapshot.Kind, kind)
	}
	if kind == providerConfigKindEmbedding && snapshot.Dimensions <= 0 {
		return errors.New("embedding provider config snapshot dimensions is required")
	}
	return nil
}

func (s *Server) resolveProviderConfigSnapshot(
	ctx context.Context,
	kind providerConfigKind,
) (providerConfigSnapshot, error) {
	if s.providerConfigErr != nil && !errors.Is(s.providerConfigErr, errProviderConfigResolverNotConfigured) {
		return providerConfigSnapshot{}, s.providerConfigErr
	}
	if s.providerConfigResolver == nil {
		return providerConfigSnapshot{}, errProviderConfigResolverNotConfigured
	}
	return s.providerConfigResolver.ResolveActiveProviderConfig(ctx, kind)
}
