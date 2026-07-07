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

func TestObservabilityConfigResolverLoadsPolicyAdmittedModelIOProjection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	if err := os.WriteFile(path, []byte(`{
		"schema_version": "observability_config_projection.v1",
		"generated_at": "2026-07-05T00:00:00Z",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "langfuse_otlp",
			"include_model_io": true,
			"sample_ratio": 1,
			"raw_capture_policy": {
				"schema_version": "raw_capture_policy.v1",
				"mode": "manual_run_capture",
				"capture_reason": "diagnose badcase req_debug_001",
				"ttl_days": 7,
				"allowed_sinks": ["openai_agents_trace", "langfuse_otlp"],
					"allowed_raw_fields": ["rendered_messages", "provider_request_body"],
					"operator_principal": "operator:test",
					"approval_ref": "approval:test:raw-capture",
					"request_id": "req_debug_001",
					"run_id": "run_debug_001",
					"trace_id": "trace_debug_001",
					"audit_required": true,
					"dsar_delete_linkage_required": true
				},
			"langfuse_otlp": {
				"endpoint": "https://cloud.langfuse.com/api/public/otel",
				"auth_header": "Basic langfuse-secret"
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

	snapshot, err := resolver.ResolveLLMDebugTraceConfig(t.Context())
	if err != nil {
		t.Fatalf("ResolveLLMDebugTraceConfig() error = %v", err)
	}

	if !snapshot.IncludeModelIO ||
		snapshot.RawCapturePolicy == nil ||
		snapshot.RawCapturePolicy.Mode != "manual_run_capture" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestObservabilityConfigResolverRejectsModelIOWithoutRawCapturePolicy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	if err := os.WriteFile(path, []byte(`{
		"schema_version": "observability_config_projection.v1",
		"generated_at": "2026-07-05T00:00:00Z",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "langfuse_otlp",
			"include_model_io": true,
			"sample_ratio": 1,
			"langfuse_otlp": {
				"endpoint": "https://cloud.langfuse.com/api/public/otel",
				"auth_header": "Basic langfuse-secret"
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

	if err == nil || !strings.Contains(err.Error(), "raw_capture_policy") {
		t.Fatalf("error = %v, want raw_capture_policy requirement", err)
	}
}

func TestObservabilityConfigResolverAllowsOffPolicyWithoutOperatorApproval(t *testing.T) {
	path := filepath.Join(t.TempDir(), "observability-projection.json")
	if err := os.WriteFile(path, []byte(`{
		"schema_version": "observability_config_projection.v1",
		"generated_at": "2026-07-05T00:00:00Z",
		"llm_debug_trace": {
			"schema_version": "llm_debug_trace_config.v1",
			"mode": "off",
			"include_model_io": false,
			"sample_ratio": 1,
			"raw_capture_policy": {
				"schema_version": "raw_capture_policy.v1",
				"mode": "off",
				"capture_reason": "default_disabled",
				"ttl_days": 0,
				"allowed_sinks": [],
				"allowed_raw_fields": [],
				"audit_required": false,
				"dsar_delete_linkage_required": false
			}
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

	if snapshot.RawCapturePolicy == nil ||
		snapshot.RawCapturePolicy.OperatorPrincipal != nil ||
		snapshot.RawCapturePolicy.ApprovalRef != nil {
		t.Fatalf("snapshot.RawCapturePolicy = %#v", snapshot.RawCapturePolicy)
	}
}

func TestObservabilityConfigResolverRejectsNonOffPolicyWithoutOperatorApproval(t *testing.T) {
	cases := []struct {
		name      string
		omission  string
		extraJSON string
	}{
		{
			name:      "missing_operator",
			omission:  "operator_principal",
			extraJSON: `"approval_ref": "approval:test",`,
		},
		{
			name:      "missing_approval",
			omission:  "approval_ref",
			extraJSON: `"operator_principal": "operator:test",`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "observability-projection.json")
			if err := os.WriteFile(path, []byte(`{
				"schema_version": "observability_config_projection.v1",
				"generated_at": "2026-07-05T00:00:00Z",
				"llm_debug_trace": {
					"schema_version": "llm_debug_trace_config.v1",
					"mode": "off",
					"include_model_io": false,
					"sample_ratio": 1,
					"raw_capture_policy": {
						"schema_version": "raw_capture_policy.v1",
						"mode": "manual_run_capture",
						"capture_reason": "diagnose badcase",
						"ttl_days": 7,
							"allowed_sinks": ["s3_replay_packet"],
							"allowed_raw_fields": ["rendered_messages"],
							`+tc.extraJSON+`
							"request_id": "req_debug_001",
							"run_id": "run_debug_001",
							"trace_id": "trace_debug_001",
							"audit_required": true,
							"dsar_delete_linkage_required": true
						}
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

			_, err = resolver.ResolveLLMDebugTraceConfig(t.Context())

			if err == nil || !strings.Contains(err.Error(), "operator_principal and approval_ref") {
				t.Fatalf("missing %s error = %v, want operator/approval requirement", tc.omission, err)
			}
		})
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
