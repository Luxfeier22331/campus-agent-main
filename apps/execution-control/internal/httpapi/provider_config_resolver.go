package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type providerConfigRole string

const (
	providerConfigRoleIndexEmbedding    providerConfigRole = "index_embedding"
	providerConfigRolePrimaryAgent      providerConfigRole = "primary_agent"
	providerConfigRoleRAGQueryEmbedding providerConfigRole = "rag_query_embedding"
)

type providerConfigSnapshot struct {
	APIKey        string         `json:"api_key"`
	BaseURL       string         `json:"base_url"`
	FeatureConfig map[string]any `json:"feature_config,omitempty"`
	Dimensions    int            `json:"dimensions,omitempty"`
	Kind          string         `json:"kind"`
	Model         string         `json:"model"`
	ProfileID     string         `json:"profile_id"`
	Provider      string         `json:"provider"`
	Revision      int            `json:"revision"`
	Role          string         `json:"role"`
	TimeoutMS     int            `json:"timeout_ms"`
	Transport     string         `json:"transport"`
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
		SchemaVersion string `json:"schema_version"`
		PublicationID string `json:"publication_id"`
		PublishedAt   string `json:"published_at"`
		PublishedBy   struct {
			DisplayName string `json:"displayName"`
			PrincipalID string `json:"principalId"`
		} `json:"published_by"`
		Profiles map[string]providerConfigSnapshot `json:"profiles"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return providerConfigSnapshot{}, fmt.Errorf("decode provider config projection: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return providerConfigSnapshot{}, errors.New("provider config projection must contain one JSON value")
	}
	if payload.SchemaVersion != "provider_config_projection.v2" {
		return providerConfigSnapshot{}, errors.New("provider config projection schema_version is unsupported")
	}
	if strings.TrimSpace(payload.PublicationID) == "" || strings.TrimSpace(payload.PublishedAt) == "" ||
		strings.TrimSpace(payload.PublishedBy.DisplayName) == "" || strings.TrimSpace(payload.PublishedBy.PrincipalID) == "" {
		return providerConfigSnapshot{}, errors.New("provider config projection publication identity is required")
	}
	if _, err := time.Parse(time.RFC3339, payload.PublishedAt); err != nil {
		return providerConfigSnapshot{}, errors.New("provider config projection published_at is invalid")
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

func requireSecureSecretProjectionFile(path string, label string) error {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", label, err)
	}
	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("%s path must be a regular file", label)
	}
	permissions := fileInfo.Mode().Perm()
	if permissions != 0o600 && permissions != 0o440 {
		return fmt.Errorf("%s file permissions must be 0600 or 0440", label)
	}
	return nil
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
