package httpapi

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestProviderConfigResolverLoadsLocalProjectionArtifact(t *testing.T) {
	path := writeProviderProjectionForTest(t)
	resolver, err := newProviderConfigResolver(config.Config{
		ProviderConfigSnapshotPath: path,
	})
	if err != nil {
		t.Fatalf("newProviderConfigResolver() error = %v", err)
	}

	snapshot, err := resolver.ResolveActiveProviderConfig(t.Context(), providerConfigRolePrimaryAgent)
	if err != nil {
		t.Fatalf("ResolveActiveProviderConfig() error = %v", err)
	}

	if snapshot.APIKey != "primary-key" || snapshot.Role != "primary_agent" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestProviderConfigResolverLoadsKubernetesGroupReadableProjection(t *testing.T) {
	path := writeProviderProjectionForTest(t)
	if err := os.Chmod(path, 0o440); err != nil {
		t.Fatal(err)
	}
	resolver, err := newProviderConfigResolver(config.Config{
		ProviderConfigSnapshotPath: path,
	})
	if err != nil {
		t.Fatalf("newProviderConfigResolver() error = %v", err)
	}

	_, err = resolver.ResolveActiveProviderConfig(t.Context(), providerConfigRolePrimaryAgent)
	if err != nil {
		t.Fatalf("ResolveActiveProviderConfig() error = %v", err)
	}
}

func TestProviderConfigResolverWithoutProjectionIsNotConfigured(t *testing.T) {
	_, err := newProviderConfigResolver(config.Config{})

	if err == nil || !errors.Is(err, errProviderConfigResolverNotConfigured) {
		t.Fatalf("error = %v, want not configured", err)
	}
}

func TestProviderConfigResolverRejectsInsecureProjectionPermissions(t *testing.T) {
	path := writeProviderProjectionForTest(t)
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	resolver, err := newProviderConfigResolver(config.Config{
		ProviderConfigSnapshotPath: path,
	})
	if err != nil {
		t.Fatalf("newProviderConfigResolver() error = %v", err)
	}

	_, err = resolver.ResolveActiveProviderConfig(t.Context(), providerConfigRolePrimaryAgent)

	if err == nil || !strings.Contains(err.Error(), "0600 or 0440") {
		t.Fatalf("error = %v, want secure permission requirement", err)
	}
}

func TestProviderConfigResolverRejectsUnknownProjectionFields(t *testing.T) {
	path := writeProviderProjectionForTest(t)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	invalid := strings.Replace(string(data), `"profiles":`, `"legacy":true,"profiles":`, 1)
	if err := os.WriteFile(path, []byte(invalid), 0o600); err != nil {
		t.Fatal(err)
	}
	resolver, err := newProviderConfigResolver(config.Config{ProviderConfigSnapshotPath: path})
	if err != nil {
		t.Fatal(err)
	}

	_, err = resolver.ResolveActiveProviderConfig(t.Context(), providerConfigRolePrimaryAgent)

	if err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("error = %v, want unknown field rejection", err)
	}
}

func writeProviderProjectionForTest(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "provider-projection.json")
	payload := `{
		"schema_version": "provider_config_projection.v2",
			"publication_id": "provider_publication_test",
			"published_at": "2026-07-16T00:00:00.000Z",
			"published_by": {"displayName":"Operator","principalId":"operator-1"},
		"profiles": {
			"primary_agent": {
				"api_key": "primary-key",
				"base_url": "https://llm.example/v1",
				"kind": "prompt",
				"model": "gpt-test",
				"profile_id": "provider_profile_primary",
				"provider": "openai",
				"revision": 2,
				"role": "primary_agent",
				"timeout_ms": 30000,
				"transport": "responses"
			},
			"rag_query_embedding": {
				"api_key": "embedding-key",
				"base_url": "https://embedding.example/v1",
				"dimensions": 2560,
				"kind": "embedding",
				"model": "Qwen3-Embedding-4B",
				"profile_id": "provider_profile_rag_query_embedding",
				"provider": "openai-compatible",
				"revision": 2,
				"role": "rag_query_embedding",
				"timeout_ms": 12000,
				"transport": "embeddings"
			}
		}
	}`
	if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
