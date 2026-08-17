package providerconfig

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var ErrResolverNotConfigured = errors.New("provider config resolver is not configured")

type Resolver interface {
	ResolveActiveProviderConfig(context.Context, Kind) (RuntimeSetting, error)
}

type ResolverOptions struct {
	DatabaseURL string
	KeyringPath string
}

type StoreResolver struct {
	store *Store
}

func NewResolver(ctx context.Context, options ResolverOptions) (*StoreResolver, error) {
	if strings.TrimSpace(options.DatabaseURL) == "" || strings.TrimSpace(options.KeyringPath) == "" {
		return nil, ErrResolverNotConfigured
	}
	keyring, err := LoadKeyring(options.KeyringPath)
	if err != nil {
		return nil, err
	}
	store, err := NewStore(ctx, options.DatabaseURL, keyring)
	if err != nil {
		return nil, err
	}
	return &StoreResolver{store: store}, nil
}

func (resolver *StoreResolver) ResolveActiveProviderConfig(
	ctx context.Context,
	kind Kind,
) (RuntimeSetting, error) {
	if resolver == nil || resolver.store == nil {
		return RuntimeSetting{}, ErrResolverNotConfigured
	}
	setting, err := resolver.store.Resolve(ctx, kind)
	if err != nil {
		return RuntimeSetting{}, err
	}
	if err := ValidateRuntimeSetting(setting, kind); err != nil {
		return RuntimeSetting{}, err
	}
	return setting, nil
}

func (resolver *StoreResolver) Close() {
	if resolver != nil && resolver.store != nil {
		resolver.store.Close()
	}
}

func (resolver *StoreResolver) Store() *Store {
	if resolver == nil {
		return nil
	}
	return resolver.store
}

func ValidateRuntimeSetting(setting RuntimeSetting, kind Kind) error {
	required := []struct {
		name  string
		value string
	}{
		{"api_key", setting.APIKey},
		{"base_url", setting.BaseURL},
		{"model", setting.Model},
		{"provider", setting.Provider},
		{"transport", setting.Transport},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("provider config snapshot %s is required", item.name)
		}
	}
	if setting.Kind != kind {
		return fmt.Errorf("provider config snapshot kind = %q, want %q", setting.Kind, kind)
	}
	if kind == KindEmbedding {
		if setting.Transport != "embeddings" {
			return errors.New("embedding provider config snapshot transport must be embeddings")
		}
	} else if kind == KindLLM && setting.Transport != "responses" && setting.Transport != "chat_completions" {
		return errors.New("llm provider config snapshot transport is invalid")
	}
	return nil
}

// AdmissionHash excludes secrets and storage identity. It is the immutable
// model contract carried by an admitted run.
func AdmissionHash(setting RuntimeSetting) string {
	payload := map[string]any{
		"base_url":  strings.TrimSpace(setting.BaseURL),
		"kind":      strings.TrimSpace(string(setting.Kind)),
		"model":     strings.TrimSpace(setting.Model),
		"provider":  strings.TrimSpace(setting.Provider),
		"transport": strings.TrimSpace(setting.Transport),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}
