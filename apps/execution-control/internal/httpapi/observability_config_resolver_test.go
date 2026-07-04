package httpapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestObservabilityConfigResolverLoadsOffProjectionArtifact(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	if err := os.WriteFile(path, []byte(`{
		"schema_version": "observability_config_projection.v1",
		"generated_at": "2026-07-02T00:00:00Z",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "off",
			"include_model_io": false,
			"sample_ratio": 1
		}
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	resolver, err := newObservabilityConfigResolver(config.Config{
		ObservabilityConfigProjectionPath: path,
	})
	if err != nil {
		t.Fatalf("newObservabilityConfigResolver() error = %v", err)
	}

	snapshot, err := resolver.ResolveLLMDebugTraceConfig(t.Context())
	if err != nil {
		t.Fatalf("ResolveLLMDebugTraceConfig() error = %v", err)
	}

	if snapshot.Mode != "off" || snapshot.SampleRatio != 1 {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestObservabilityConfigResolverLoadsLangfuseProjectionArtifact(t *testing.T) {
	path := writeObservabilityProjectionForTest(t, 0o600)
	resolver, err := newObservabilityConfigResolver(config.Config{
		ObservabilityConfigProjectionPath: path,
	})
	if err != nil {
		t.Fatalf("newObservabilityConfigResolver() error = %v", err)
	}

	snapshot, err := resolver.ResolveLLMDebugTraceConfig(t.Context())
	if err != nil {
		t.Fatalf("ResolveLLMDebugTraceConfig() error = %v", err)
	}

	if snapshot.Mode != "langfuse_otlp" ||
		snapshot.LangfuseOTLP == nil ||
		snapshot.LangfuseOTLP.AuthHeader != "Basic langfuse-secret" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestObservabilityConfigResolverRejectsInsecureSecretProjectionPermissions(t *testing.T) {
	path := writeObservabilityProjectionForTest(t, 0o640)
	resolver, err := newObservabilityConfigResolver(config.Config{
		ObservabilityConfigProjectionPath: path,
	})
	if err != nil {
		t.Fatalf("newObservabilityConfigResolver() error = %v", err)
	}

	_, err = resolver.ResolveLLMDebugTraceConfig(t.Context())

	if err == nil || !strings.Contains(err.Error(), "0600") {
		t.Fatalf("error = %v, want 0600 permission requirement", err)
	}
}

func TestObservabilityConfigResolverRejectsIncompleteEnabledConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	if err := os.WriteFile(path, []byte(`{
		"schema_version": "observability_config_projection.v1",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "langfuse_otlp",
			"include_model_io": false,
			"sample_ratio": 1,
			"langfuse_otlp": {
				"endpoint": "https://cloud.langfuse.com/api/public/otel"
			}
		}
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	resolver, err := newObservabilityConfigResolver(config.Config{
		ObservabilityConfigProjectionPath: path,
	})
	if err != nil {
		t.Fatalf("newObservabilityConfigResolver() error = %v", err)
	}

	_, err = resolver.ResolveLLMDebugTraceConfig(t.Context())

	if err == nil || !strings.Contains(err.Error(), "auth_header") {
		t.Fatalf("error = %v, want auth_header requirement", err)
	}
}

func TestObservabilityConfigResolverRejectsNonLangfuseOTLPShape(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		want    string
	}{
		{
			name: "non_basic_auth",
			payload: `{
				"endpoint": "https://cloud.langfuse.com/api/public/otel",
				"auth_header": "Bearer token"
			}`,
			want: "Basic auth",
		},
		{
			name: "wrong_endpoint",
			payload: `{
				"endpoint": "https://otel.example/v1/traces",
				"auth_header": "Basic langfuse-secret"
			}`,
			want: "/api/public/otel",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "observability-projection.json")
			payload := `{
				"schema_version": "observability_config_projection.v1",
				"llm_debug_trace": {
					"schema_version": "llm_debug_trace_config.v1",
					"mode": "langfuse_otlp",
					"include_model_io": false,
					"sample_ratio": 1,
					"langfuse_otlp": ` + tc.payload + `
				}
			}`
			if err := os.WriteFile(path, []byte(payload), 0o600); err != nil {
				t.Fatal(err)
			}
			resolver, err := newObservabilityConfigResolver(config.Config{
				ObservabilityConfigProjectionPath: path,
			})
			if err != nil {
				t.Fatalf("newObservabilityConfigResolver() error = %v", err)
			}

			_, err = resolver.ResolveLLMDebugTraceConfig(t.Context())

			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func writeObservabilityProjectionForTest(t *testing.T, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	payload := `{
		"schema_version": "observability_config_projection.v1",
		"generated_at": "2026-07-02T00:00:00Z",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "langfuse_otlp",
			"include_model_io": false,
			"sample_ratio": 0.25,
			"langfuse_otlp": {
				"endpoint": "https://cloud.langfuse.com/api/public/otel",
				"auth_header": "Basic langfuse-secret",
				"public_trace_base_url": "https://cloud.langfuse.com/project/demo/traces"
			}
		}
	}`
	if err := os.WriteFile(path, []byte(payload), mode); err != nil {
		t.Fatal(err)
	}
	return path
}
