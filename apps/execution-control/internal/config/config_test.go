package config

import (
	"strings"
	"testing"
)

func TestRuntimeUsesFixedRuntimePolicy(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	cfg, err := loadRuntimeFromTestEnv(t)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	if cfg.Host != "0.0.0.0" || cfg.Port != 8000 {
		t.Fatalf("unexpected HTTP binding: %s:%d", cfg.Host, cfg.Port)
	}
	if cfg.TemporalTaskQueue != "campus-agent.workflow.v3" {
		t.Fatalf("workflow task queue = %q", cfg.TemporalTaskQueue)
	}
	if cfg.TemporalWorkflowExecutionTimeoutSeconds != 900 {
		t.Fatalf("workflow timeout = %d", cfg.TemporalWorkflowExecutionTimeoutSeconds)
	}
	if cfg.ProviderConfigKeyringPath != fixedProviderConfigKeyringPath {
		t.Fatalf("provider keyring path = %q", cfg.ProviderConfigKeyringPath)
	}
	if cfg.MaxConcurrentAnswers != 8 || cfg.QueueCapacity != 24 || cfg.QueueTimeoutMS != 3_000 {
		t.Fatalf("unexpected admission limits: %#v", cfg)
	}
	if cfg.RequestTimeoutMS != 95_000 || cfg.ShutdownGraceMS != 95_000 {
		t.Fatalf("unexpected request limits: %#v", cfg)
	}
	if cfg.AgentRuntimeDeadlineMS != 90_000 || cfg.AgentRuntimeMaxOutputTokens != 2_048 {
		t.Fatalf("unexpected agent limits: %#v", cfg)
	}
	if cfg.RAGTopKMax != 8 || cfg.RAGEmbeddingTimeoutMS != 10_000 || cfg.RAGQdrantTimeoutMS != 60_000 {
		t.Fatalf("unexpected RAG limits: %#v", cfg)
	}
	if cfg.QueryServingTargetsPath != "/etc/campus-agent/query-serving-targets.v3.json" {
		t.Fatalf("query targets path = %q", cfg.QueryServingTargetsPath)
	}
}

func TestRuntimeAndMemoryLoadersUseOnlyOwnedInputs(t *testing.T) {
	t.Run("runtime", func(t *testing.T) {
		setRuntimeEnv(t)
		cfg, err := loadRuntimeFromTestEnv(t)
		if err != nil {
			t.Fatalf("load runtime: %v", err)
		}
		if cfg.DatabaseURL != "postgresql://execution-control/campus" {
			t.Fatalf("database URL = %q", cfg.DatabaseURL)
		}
		if cfg.AppAPIExecutionSharedSecret != "app-api-secret" {
			t.Fatal("execution shared secret was not loaded")
		}
	})

	t.Run("personal-memory-command", func(t *testing.T) {
		t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
		t.Setenv("HINDSIGHT_API_BASE_URL", "http://hindsight:8000")
		t.Setenv("HINDSIGHT_API_TENANT_API_KEY", "memory-secret")
		t.Setenv("HINDSIGHT_OWNER_SALT", "owner-salt")
		cfg, err := LoadPersonalMemoryCommandFromEnv()
		if err != nil {
			t.Fatalf("load personal memory command: %v", err)
		}
		if cfg.PersonalMemoryBaseURL != "http://hindsight:8000" {
			t.Fatalf("hindsight base URL = %q", cfg.PersonalMemoryBaseURL)
		}
	})
}

func TestDeployedRuntimeReportsOwnedMissingInputs(t *testing.T) {
	for _, testCase := range []struct {
		name string
		key  string
	}{
		{name: "database", key: "EXECUTION_CONTROL_DATABASE_URL"},
		{name: "release", key: "DEPLOYMENT_RELEASE"},
		{name: "execution secret", key: "APP_API_EXECUTION_SHARED_SECRET"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			setRuntimeEnv(t)
			t.Setenv(testCase.key, "")
			_, err := loadRuntimeFromTestEnv(t)
			if err == nil || !strings.Contains(err.Error(), testCase.key) {
				t.Fatalf("error = %v, want missing %s", err, testCase.key)
			}
		})
	}
}

func TestOTelUsesStandardEnvironmentAndRemainsOptional(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("DEPLOYMENT_RELEASE", "execution-runtime@0123456789ab")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")
	withoutExporter, err := loadRuntimeFromTestEnv(t)
	if err != nil {
		t.Fatalf("load without exporter: %v", err)
	}
	if withoutExporter.OTelEnabled || withoutExporter.OTelMetricsEnabled {
		t.Fatalf("telemetry must be disabled without exporter: %#v", withoutExporter)
	}

	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
	t.Setenv("OTEL_SERVICE_NAME", "execution-workflow")
	withExporter, err := loadRuntimeFromTestEnv(t)
	if err != nil {
		t.Fatalf("load with exporter: %v", err)
	}
	if !withExporter.OTelEnabled || !withExporter.OTelMetricsEnabled || !withExporter.TemporalTracingEnabled {
		t.Fatalf("standard OTel endpoint was not enabled: %#v", withExporter)
	}
	if withExporter.OTelEndpoint != "http://otel-collector:4318/v1/traces" || withExporter.OTelMetricsEndpoint != "http://otel-collector:4318/v1/metrics" {
		t.Fatalf("common OTLP endpoint did not receive signal paths: %#v", withExporter)
	}
}

func setRuntimeEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
	t.Setenv("DEPLOYMENT_RELEASE", "execution-runtime@0123456789ab")
	t.Setenv("EXECUTION_CONTROL_DATABASE_URL", "postgres://execution-control/campus")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "execution-control-abcde")
	t.Setenv("EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", "https://app-api.internal")
	t.Setenv("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062")
	t.Setenv("APP_API_EXECUTION_SHARED_SECRET", "app-api-secret")
	t.Setenv("EXECUTION_AGENT_RUNTIME_SHARED_SECRET", "agent-secret")
	t.Setenv("OPS_WEB_INTERNAL_TOKEN", "ops-token")
}

func loadRuntimeFromTestEnv(t *testing.T) (Config, error) {
	t.Helper()
	return loadFromEnv(roleRuntime)
}
