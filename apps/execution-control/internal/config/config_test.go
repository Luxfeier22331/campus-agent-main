package config

import (
	"fmt"
	"strings"
	"testing"
)

func TestRuntimeUsesFixedRuntimePolicy(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("HOST", "")
	t.Setenv("PORT", "")
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
	if cfg.RequestTimeoutMS != 95_000 || cfg.ShutdownGraceMS != 95_000 {
		t.Fatalf("unexpected request limits: %#v", cfg)
	}
	if cfg.AgentRuntimeDeadlineMS != 240_000 || cfg.AgentRuntimeMaxOutputTokens != 0 {
		t.Fatalf("unexpected agent limits: %#v", cfg)
	}
	if cfg.ProductCallbackTimeoutMS != 5_000 {
		t.Fatalf("product callback timeout = %d", cfg.ProductCallbackTimeoutMS)
	}
}

func TestRuntimeUsesConfiguredHostPort(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("HOST", "127.0.0.1")
	t.Setenv("PORT", "27151")

	cfg, err := loadRuntimeFromTestEnv(t)
	if err != nil {
		t.Fatalf("load runtime: %v", err)
	}
	if cfg.Host != "127.0.0.1" || cfg.Port != 27151 {
		t.Fatalf("configured HTTP binding = %s:%d", cfg.Host, cfg.Port)
	}
}

func TestAnswerTransportDefaultsToBufferedUnlessStream(t *testing.T) {
	cases := []struct {
		name  string
		value string
		want  string
	}{
		{name: "unset", value: "", want: AnswerTransportBuffered},
		{name: "buffered", value: "buffered", want: AnswerTransportBuffered},
		{name: "stream", value: "stream", want: AnswerTransportStream},
		{name: "stream mixed case", value: " Stream ", want: AnswerTransportStream},
		{name: "unknown falls back to buffered", value: "sse", want: AnswerTransportBuffered},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
			t.Setenv("EXECUTION_CONTROL_ANSWER_TRANSPORT", tc.value)
			cfg, err := loadRuntimeFromTestEnv(t)
			if err != nil {
				t.Fatalf("load runtime: %v", err)
			}
			if cfg.AnswerTransport != tc.want {
				t.Fatalf("AnswerTransport = %q, want %q", cfg.AnswerTransport, tc.want)
			}
		})
	}
}

func TestRuntimeRejectsGatewayPortWithoutRoomForAdminListeners(t *testing.T) {
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "local")
	t.Setenv("PORT", "65534")

	_, err := loadRuntimeFromTestEnv(t)
	if err == nil || !strings.Contains(err.Error(), "PORT must be between") {
		t.Fatalf("error = %v, want invalid gateway port", err)
	}
}

func TestRuntimeLoaderUsesOnlyOwnedInputs(t *testing.T) {
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

func TestRuntimeRejectsAgentRuntimeSecretSurroundingWhitespace(t *testing.T) {
	for _, value := range []string{" agent-secret", "agent-secret ", "agent-secret\n", "\tagent-secret"} {
		t.Run(fmt.Sprintf("%q", value), func(t *testing.T) {
			setRuntimeEnv(t)
			t.Setenv("EXECUTION_AGENT_RUNTIME_SHARED_SECRET", value)

			_, err := loadRuntimeFromTestEnv(t)
			if err == nil || !strings.Contains(err.Error(), "must not contain surrounding whitespace") {
				t.Fatalf("error = %v, want surrounding whitespace rejection", err)
			}
		})
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
	t.Setenv("RETRIEVAL_BASE_URL", "http://campus-search:8000")
	t.Setenv("RETRIEVAL_INTERNAL_TOKEN", "retrieval-internal-token")
	t.Setenv("MODEL_CONFIG_URL", "http://model-config:8000")
}

func loadRuntimeFromTestEnv(t *testing.T) (Config, error) {
	t.Helper()
	return LoadAPIFromEnv()
}

func TestRoleConfigurationDoesNotRequireAPIDependenciesForWorker(t *testing.T) {
	setRuntimeEnv(t)
	for _, key := range []string{"OPS_WEB_INTERNAL_TOKEN", "MODEL_CONFIG_URL", "RETRIEVAL_BASE_URL", "RETRIEVAL_INTERNAL_TOKEN"} {
		t.Setenv(key, "")
	}
	cfg, err := LoadWorkerFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkerProfiles["workflow"].WorkflowTaskSlots != 16 || cfg.WorkerProfiles["activity-core"].ActivitySlots != 8 || cfg.WorkerProfiles["activity-agent"].ActivitySlots != 4 {
		t.Fatalf("worker profiles changed: %#v", cfg.WorkerProfiles)
	}
	if _, err := LoadAPIFromEnv(); err == nil {
		t.Fatal("API accepted missing API dependencies")
	}
	setRuntimeEnv(t)
	api, err := LoadAPIFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if len(api.WorkerProfiles) != 0 {
		t.Fatal("API configured worker slots")
	}
}
