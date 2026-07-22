package config

import (
	"strings"
	"testing"
)

func TestGatewayUsesFixedProductLimits(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")

	cfg, err := LoadGatewayFromEnv()
	if err != nil {
		t.Fatalf("LoadGatewayFromEnv returned error: %v", err)
	}
	if cfg.MaxConcurrentAnswers != 8 || cfg.QueueCapacity != 24 || cfg.QueueTimeoutMS != 3_000 {
		t.Fatalf("unexpected admission limits: %#v", cfg)
	}
	if cfg.RequestTimeoutMS != 95_000 || cfg.ShutdownGraceMS != 95_000 {
		t.Fatalf("unexpected request limits: %#v", cfg)
	}
	if cfg.AgentRuntimeDeadlineMS != 90_000 || cfg.AgentRuntimeMaxOutputTokens != 2_048 || cfg.AgentRuntimeMaxTurns != 6 {
		t.Fatalf("unexpected agent limits: %#v", cfg)
	}
	if cfg.AgentRuntimeSearchLimit != 3 || cfg.AgentRuntimeInputCharLimit != 8_000 || cfg.AgentRuntimeContextCharLimit != 16_000 {
		t.Fatalf("unexpected agent context limits: %#v", cfg)
	}
	if cfg.RAGTopKMax != 8 || cfg.RAGEmbeddingTimeoutMS != 10_000 || cfg.RAGQdrantTimeoutMS != 60_000 {
		t.Fatalf("unexpected RAG limits: %#v", cfg)
	}
	if cfg.PersonalMemoryTimeoutSeconds != 90 || cfg.PersonalMemoryRecallLimit != 8 || cfg.PersonalMemoryRecallMaxTokens != 2_500 || cfg.PersonalMemoryContextCharBudget != 2_500 {
		t.Fatalf("unexpected personal memory limits: %#v", cfg)
	}
	if cfg.QueryServingTargetsPath != "/etc/campus-agent/query-serving-targets.v1.json" {
		t.Fatalf("query serving targets path = %q", cfg.QueryServingTargetsPath)
	}
}

func TestRoleLoadersRequireOnlyTheirDeployedDependencies(t *testing.T) {
	t.Run("gateway", func(t *testing.T) {
		setTemporalEnv(t, "execution-control-6b9d7f8c9d-abcde")
		t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime/campus")
		t.Setenv("APP_API_EXECUTION_SHARED_SECRET", "app-api-secret")
		t.Setenv("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062")
		cfg, err := LoadGatewayFromEnv()
		if err != nil {
			t.Fatalf("LoadGatewayFromEnv returned error: %v", err)
		}
		if cfg.RunProjectionDatabaseURL != "postgresql://runtime/campus" {
			t.Fatalf("run projection URL = %q", cfg.RunProjectionDatabaseURL)
		}
	})

	t.Run("workflow", func(t *testing.T) {
		setTemporalEnv(t, "execution-workflow-abcde")
		if _, err := LoadWorkflowWorkerFromEnv(); err != nil {
			t.Fatalf("workflow loader required unrelated dependencies: %v", err)
		}
	})

	t.Run("activity-core", func(t *testing.T) {
		setTemporalEnv(t, "execution-core-abcde")
		t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime/campus")
		t.Setenv("EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL", "https://app-api.internal")
		t.Setenv("APP_API_EXECUTION_SHARED_SECRET", "app-api-secret")
		if _, err := LoadCoreActivityWorkerFromEnv(); err != nil {
			t.Fatalf("core activity loader required optional memory or Langfuse settings: %v", err)
		}
	})

	t.Run("activity-agent", func(t *testing.T) {
		setTemporalEnv(t, "execution-agent-abcde")
		t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime/campus")
		t.Setenv("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062")
		t.Setenv("EXECUTION_AGENT_RUNTIME_SHARED_SECRET", "agent-secret")
		t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL", "postgres://provider/campus")
		t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", "/run/provider/keyring.json")
		if _, err := LoadAgentActivityWorkerFromEnv(); err != nil {
			t.Fatalf("agent activity loader required optional retrieval settings: %v", err)
		}
	})

	t.Run("provider-admin", func(t *testing.T) {
		t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
		t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL", "postgres://provider/campus")
		t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", "/run/provider/keyring.json")
		t.Setenv("OPS_WEB_INTERNAL_TOKEN", "ops-token")
		if _, err := LoadProviderConfigAdminFromEnv(); err != nil {
			t.Fatalf("provider admin loader required runtime dependencies: %v", err)
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
	setTemporalEnv(t, "staging:activity-agent:001")
	t.Setenv("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL", "postgres://runtime/campus")
	t.Setenv("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062")
	t.Setenv("EXECUTION_AGENT_RUNTIME_SHARED_SECRET", "agent-secret")
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL", "")
	t.Setenv("EXECUTION_CONTROL_PROVIDER_CONFIG_KEYRING_PATH", "/run/provider/keyring.json")

	_, err := LoadAgentActivityWorkerFromEnv()
	if err == nil || !strings.Contains(err.Error(), "EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL") {
		t.Fatalf("error = %v, want missing provider reader database", err)
	}
}

func TestOTelUsesStandardEnvironmentAndRemainsOptional(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("DEPLOYMENT_RELEASE", "execution-runtime@0123456789ab")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "")

	withoutExporter, err := LoadWorkflowWorkerFromEnv()
	if err != nil {
		t.Fatalf("load without exporter: %v", err)
	}
	if withoutExporter.OTelEnabled || withoutExporter.OTelMetricsEnabled {
		t.Fatalf("telemetry must be disabled without an exporter: %#v", withoutExporter)
	}

	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318")
	t.Setenv("OTEL_SERVICE_NAME", "execution-workflow")
	withExporter, err := LoadWorkflowWorkerFromEnv()
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
	withSignalEndpoints, err := LoadWorkflowWorkerFromEnv()
	if err != nil {
		t.Fatalf("load with signal endpoints: %v", err)
	}
	if withSignalEndpoints.OTelEndpoint != "https://otel.example.test/custom-traces" ||
		withSignalEndpoints.OTelMetricsEndpoint != "https://otel.example.test/custom-metrics" {
		t.Fatalf("signal-specific OTLP endpoints must remain unchanged: %#v", withSignalEndpoints)
	}
}

func setTemporalEnv(t *testing.T, identity string) {
	t.Helper()
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", identity)
}
