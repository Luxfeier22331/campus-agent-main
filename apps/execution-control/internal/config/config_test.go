package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeUsesFixedProductLimits(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	setProtectedPayloadKeyringEnv(t)

	cfg, err := LoadRuntimeFromEnv()
	if err != nil {
		t.Fatalf("LoadRuntimeFromEnv returned error: %v", err)
	}
	if cfg.MaxConcurrentAnswers != 8 || cfg.QueueCapacity != 24 || cfg.QueueTimeoutMS != 3_000 {
		t.Fatalf("unexpected admission limits: %#v", cfg)
	}
	if cfg.RequestTimeoutMS != 95_000 || cfg.ShutdownGraceMS != 95_000 {
		t.Fatalf("unexpected request limits: %#v", cfg)
	}
	if cfg.TemporalWorkflowExecutionTimeoutSeconds != 900 {
		t.Fatalf("workflow execution timeout = %d, want 900 seconds", cfg.TemporalWorkflowExecutionTimeoutSeconds)
	}
	if cfg.AgentRuntimeDeadlineMS != 90_000 || cfg.AgentRuntimeMaxOutputTokens != 2_048 {
		t.Fatalf("unexpected agent limits: %#v", cfg)
	}
	if cfg.AgentRuntimeInputCharLimit != 8_000 || cfg.AgentRuntimeContextCharLimit != 16_000 {
		t.Fatalf("unexpected agent context limits: %#v", cfg)
	}
	if cfg.RAGTopKMax != 8 || cfg.RAGEmbeddingTimeoutMS != 10_000 || cfg.RAGQdrantTimeoutMS != 60_000 {
		t.Fatalf("unexpected RAG limits: %#v", cfg)
	}
	if cfg.PersonalMemoryTimeoutSeconds != 90 || cfg.PersonalMemoryRecallLimit != 8 || cfg.PersonalMemoryRecallMaxTokens != 2_500 || cfg.PersonalMemoryContextCharBudget != 2_500 {
		t.Fatalf("unexpected personal memory limits: %#v", cfg)
	}
	if cfg.QueryServingTargetsPath != "/etc/campus-agent/query-serving-targets.v3.json" {
		t.Fatalf("query serving targets path = %q", cfg.QueryServingTargetsPath)
	}
}

func TestRuntimeAndMemoryLoadersRequireOnlyTheirDeployedDependencies(t *testing.T) {
	t.Run("runtime", func(t *testing.T) {
		setRuntimeEnv(t)
		cfg, err := LoadRuntimeFromEnv()
		if err != nil {
			t.Fatalf("LoadRuntimeFromEnv returned error: %v", err)
		}
		if cfg.TemporalTaskQueue != "campus-agent.workflow" {
			t.Fatalf("runtime workflow task queue = %q", cfg.TemporalTaskQueue)
		}
	})

	t.Run("personal-memory-command", func(t *testing.T) {
		t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
		t.Setenv("PERSONAL_MEMORY_BASE_URL", "http://hindsight:8000")
		t.Setenv("PERSONAL_MEMORY_API_SECRET", "memory-secret")
		t.Setenv("PERSONAL_MEMORY_OWNER_SALT", "owner-salt")
		if _, err := LoadPersonalMemoryCommandFromEnv(); err != nil {
			t.Fatalf("personal memory command loader required runtime dependencies: %v", err)
		}
	})
}

func TestDeployedRoleReportsItsMissingDependency(t *testing.T) {
	setRuntimeEnv(t)
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL", "")

	_, err := LoadRuntimeFromEnv()
	if err == nil || !strings.Contains(err.Error(), "EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL") {
		t.Fatalf("error = %v, want missing provider reader database", err)
	}
}

func TestDeployedRolesRequireReleaseIdentity(t *testing.T) {
	setRuntimeEnv(t)
	t.Setenv("DEPLOYMENT_RELEASE", "")
	_, err := LoadRuntimeFromEnv()
	if err == nil || !strings.Contains(err.Error(), "DEPLOYMENT_RELEASE") {
		t.Fatalf("error = %v, want missing deployment release", err)
	}
}

func TestRuntimeRequiresExecutionInputCredential(t *testing.T) {
	setRuntimeEnv(t)
	t.Setenv("APP_API_EXECUTION_INPUT_SHARED_SECRET", "")
	_, err := LoadRuntimeFromEnv()
	if err == nil || !strings.Contains(err.Error(), "APP_API_EXECUTION_INPUT_SHARED_SECRET") {
		t.Fatalf("error = %v, want missing execution input credential", err)
	}
}

func TestProtectedPayloadRolesLoadDedicatedKeyring(t *testing.T) {
	for _, testCase := range []struct {
		name string
		load func() (Config, error)
	}{
		{name: "runtime", load: LoadRuntimeFromEnv},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
			path := setProtectedPayloadKeyringEnv(t)
			cfg, err := testCase.load()
			if err != nil {
				t.Fatalf("load role with protected payload keyring: %v", err)
			}
			if cfg.ProtectedPayloadKeyringPath != path || cfg.ProtectedPayloadKeyring == nil {
				t.Fatalf("protected payload keyring was not loaded: %#v", cfg)
			}
			keyID, _, err := cfg.ProtectedPayloadKeyring.ActiveKey()
			if err != nil || keyID != "key-current" {
				t.Fatalf("active protected payload key id = %q, error = %v", keyID, err)
			}
		})
	}
}

func TestProtectedPayloadRolesRejectMissingOrInvalidKeyring(t *testing.T) {
	validKey := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	for _, testCase := range []struct {
		name        string
		payload     string
		mode        os.FileMode
		wantMessage string
	}{
		{
			name:        "missing path",
			wantMessage: "EXECUTION_CONTROL_PROTECTED_PAYLOAD_KEYRING_PATH",
		},
		{
			name:        "active key absent",
			payload:     fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-old":%q}}`, validKey),
			mode:        0o600,
			wantMessage: "active key id is not present",
		},
		{
			name:        "insecure permissions",
			payload:     fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-current":%q}}`, validKey),
			mode:        0o644,
			wantMessage: "0400, 0440, or 0600",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
			t.Setenv("EXECUTION_CONTROL_PROTECTED_PAYLOAD_KEYRING_PATH", "")
			if testCase.payload != "" {
				path := writeProtectedPayloadKeyring(t, testCase.payload, testCase.mode)
				t.Setenv("EXECUTION_CONTROL_PROTECTED_PAYLOAD_KEYRING_PATH", path)
			}
			_, err := LoadRuntimeFromEnv()
			if err == nil || !strings.Contains(err.Error(), testCase.wantMessage) {
				t.Fatalf("error = %v, want message containing %q", err, testCase.wantMessage)
			}
		})
	}
}

func TestRolesWithoutProtectedPayloadAccessDoNotLoadKeyring(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("EXECUTION_CONTROL_PROTECTED_PAYLOAD_KEYRING_PATH", filepath.Join(t.TempDir(), "missing.json"))
	cfg, err := LoadPersonalMemoryCommandFromEnv()
	if err != nil {
		t.Fatalf("role loaded unrelated protected payload keyring: %v", err)
	}
	if cfg.ProtectedPayloadKeyring != nil {
		t.Fatal("role received protected payload key material")
	}
}

func TestOTelUsesStandardEnvironmentAndRemainsOptional(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("DEPLOYMENT_RELEASE", "execution-runtime@0123456789ab")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	setProtectedPayloadKeyringEnv(t)

	withoutExporter, err := LoadRuntimeFromEnv()
	if err != nil {
		t.Fatalf("load without exporter: %v", err)
	}
	if withoutExporter.OTelEnabled || withoutExporter.OTelMetricsEnabled {
		t.Fatalf("telemetry must be disabled without an exporter: %#v", withoutExporter)
	}

	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
	t.Setenv("OTEL_SERVICE_NAME", "execution-workflow")
	withExporter, err := LoadRuntimeFromEnv()
	if err != nil {
		t.Fatalf("load with exporter: %v", err)
	}
	if !withExporter.OTelEnabled || !withExporter.OTelMetricsEnabled || !withExporter.TemporalTracingEnabled {
		t.Fatalf("standard OTel endpoint was not enabled: %#v", withExporter)
	}
	if withExporter.OTelServiceName != "execution-workflow" || withExporter.DeploymentRelease != "execution-runtime@0123456789ab" {
		t.Fatalf("standard telemetry identity was not loaded: %#v", withExporter)
	}
	if withExporter.OTelEndpoint != "http://otel-collector:4318/v1/traces" ||
		withExporter.OTelMetricsEndpoint != "http://otel-collector:4318/v1/metrics" {
		t.Fatalf("common OTLP endpoint did not receive signal paths: %#v", withExporter)
	}

	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "https://otel.example.test/custom-traces")
	t.Setenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://otel.example.test/custom-metrics")
	withSignalEndpoints, err := LoadRuntimeFromEnv()
	if err != nil {
		t.Fatalf("load with signal endpoints: %v", err)
	}
	if withSignalEndpoints.OTelEndpoint != "https://otel.example.test/custom-traces" ||
		withSignalEndpoints.OTelMetricsEndpoint != "https://otel.example.test/custom-metrics" {
		t.Fatalf("signal-specific OTLP endpoints must remain unchanged: %#v", withSignalEndpoints)
	}
}

func setRuntimeEnv(t *testing.T) {
	t.Helper()
	setTemporalEnv(t, "execution-control-abcde")
	setDeploymentReleaseEnv(t)
	setProtectedPayloadKeyringEnv(t)
	t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime/campus")
	t.Setenv("EXECUTION_CONTROL_TOOL_READ_DATABASE_URL", "postgres://tool-read/campus")
	t.Setenv("EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", "https://app-api.internal")
	t.Setenv("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062")
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL", "postgres://provider-reader/campus")
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL", "postgres://provider-admin/campus")
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", "/run/provider/keyring.json")
	t.Setenv("APP_API_EXECUTION_SHARED_SECRET", "app-api-secret")
	t.Setenv("APP_API_EXECUTION_INPUT_SHARED_SECRET", "execution-input-secret")
	t.Setenv("EXECUTION_AGENT_RUNTIME_SHARED_SECRET", "agent-secret")
	t.Setenv("OPS_WEB_INTERNAL_TOKEN", "ops-token")
}

func setTemporalEnv(t *testing.T, identity string) {
	t.Helper()
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", identity)
}

func setDeploymentReleaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DEPLOYMENT_RELEASE", "execution-runtime@0123456789ab")
}

func setProtectedPayloadKeyringEnv(t *testing.T) string {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	path := writeProtectedPayloadKeyring(
		t,
		fmt.Sprintf(`{"active_key_id":"key-current","keys":{"key-current":%q}}`, key),
		0o600,
	)
	t.Setenv("EXECUTION_CONTROL_PROTECTED_PAYLOAD_KEYRING_PATH", path)
	return path
}

func writeProtectedPayloadKeyring(t *testing.T, payload string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "protected-payload-keyring.json")
	if err := os.WriteFile(path, []byte(payload), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}
