package workermain

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace/noop"
)

func TestTemporalClientOptionsApplyTracingInterceptors(t *testing.T) {
	tracing := mustTracingInterceptors(t)

	options := temporalClientOptions(
		config.Config{
			TemporalAddress:        "temporal:7233",
			TemporalNamespace:      "campus-agent-staging",
			TemporalWorkerIdentity: "staging:activity-context:001",
		},
		tracing,
	)

	if options.HostPort != "temporal:7233" {
		t.Fatalf("host port = %q, want temporal:7233", options.HostPort)
	}
	if options.Namespace != "campus-agent-staging" {
		t.Fatalf("namespace = %q, want campus-agent-staging", options.Namespace)
	}
	if options.Identity != "staging:activity-context:001" {
		t.Fatalf("identity = %q, want staging:activity-context:001", options.Identity)
	}
	if len(options.Interceptors) != 1 {
		t.Fatalf("client interceptors = %d, want 1", len(options.Interceptors))
	}
}

func TestWorkerOptionsForRolePreservesProfileAndAppliesTracing(t *testing.T) {
	tracing := mustTracingInterceptors(t)

	options, err := workerOptionsForRole(
		config.Config{
			WorkerProfiles: map[string]config.WorkerProfile{
				string(RoleKnowledgeRetrieval): {
					ActivitySlots:       3,
					ActivityTaskPollers: 2,
				},
			},
		},
		RoleKnowledgeRetrieval,
		tracing,
	)
	if err != nil {
		t.Fatalf("workerOptionsForRole returned error: %v", err)
	}

	if options.MaxConcurrentActivityExecutionSize != 3 {
		t.Fatalf("activity slots = %d, want 3", options.MaxConcurrentActivityExecutionSize)
	}
	if options.MaxConcurrentActivityTaskPollers != 2 {
		t.Fatalf("activity task pollers = %d, want 2", options.MaxConcurrentActivityTaskPollers)
	}
	if len(options.Interceptors) != 1 {
		t.Fatalf("worker interceptors = %d, want 1", len(options.Interceptors))
	}
}

func TestWorkerOptionsForRoleAppliesTracingToUnprofiledWorkers(t *testing.T) {
	tracing := mustTracingInterceptors(t)

	options, err := workerOptionsForRole(config.Config{}, RoleContext, tracing)
	if err != nil {
		t.Fatalf("workerOptionsForRole returned error: %v", err)
	}

	if len(options.Interceptors) != 1 {
		t.Fatalf("worker interceptors = %d, want 1", len(options.Interceptors))
	}
}

func TestCheckRuntimeValidatesRoleConfiguration(t *testing.T) {
	setWorkerRuntimeEnv(t)

	if err := CheckRuntime(RoleKnowledgeRetrieval); err != nil {
		t.Fatalf("CheckRuntime returned error: %v", err)
	}
}

func TestCheckRuntimeRejectsInvalidTemporalConfiguration(t *testing.T) {
	setWorkerRuntimeEnv(t)
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "")

	err := CheckRuntime(RoleKnowledgeRetrieval)
	if err == nil {
		t.Fatal("expected CheckRuntime to reject missing Temporal address")
	}
	if !strings.Contains(err.Error(), "EXECUTION_CONTROL_TEMPORAL_ADDRESS") {
		t.Fatalf("error = %q, want Temporal address diagnostic", err.Error())
	}
}

func TestNewWorkerTelemetryRuntimeInstallsProviderBeforeTracing(t *testing.T) {
	otel.SetTracerProvider(noop.NewTracerProvider())
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
	})

	runtime, err := newWorkerTelemetryRuntime(
		context.Background(),
		config.Config{
			OTelEnabled:                  true,
			OTelEndpoint:                 "http://collector:4318/v1/traces",
			OTelServiceName:              "campus-execution-control",
			OTelExportTimeoutMS:          int(time.Second / time.Millisecond),
			OTelAllowedAttributesVersion: "execution-control-otel-attrs-v1",
			TemporalTracingEnabled:       true,
		},
		RoleWorkflow,
		nil,
	)
	if err != nil {
		t.Fatalf("newWorkerTelemetryRuntime returned error: %v", err)
	}
	t.Cleanup(func() {
		shutdownWorkerTelemetry(runtime, config.Config{ShutdownGraceMS: 1000}, nil)
	})

	if _, ok := otel.GetTracerProvider().(noop.TracerProvider); ok {
		t.Fatal("global OTel tracer provider is still noop after worker telemetry bootstrap")
	}
}

func TestNewWorkerTelemetryRuntimeRejectsTemporalTracingWithoutOTel(t *testing.T) {
	_, err := newWorkerTelemetryRuntime(
		context.Background(),
		config.Config{
			TemporalTracingEnabled: true,
		},
		RoleWorkflow,
		nil,
	)
	if err == nil {
		t.Fatal("expected Temporal tracing without OTel to fail")
	}
}

func mustTracingInterceptors(t *testing.T) temporalruntime.TracingInterceptors {
	t.Helper()
	interceptors, err := temporalruntime.NewTracingInterceptors(temporalruntime.TracingOptions{
		Enabled:      true,
		OTelEndpoint: "http://collector:4318/v1/traces",
	})
	if err != nil {
		t.Fatalf("NewTracingInterceptors returned error: %v", err)
	}
	return interceptors
}

func setWorkerRuntimeEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DEPLOYMENT_ENVIRONMENT", "staging")
	t.Setenv("EXECUTION_CONTROL_RUNTIME_PROFILE", "staging")
	t.Setenv("EXECUTION_CONTROL_RUNTIME_RELEASE", "execution-control@test")
	t.Setenv("EXECUTION_CONTROL_METRICS_BEARER_TOKEN", "metrics-secret")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_URL", "http://app-api.internal/audit")
	t.Setenv("EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET", "audit-secret")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:activity-knowledge-retrieval:001")
	t.Setenv("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT", "workflow-salt")
	t.Setenv("PERSONAL_MEMORY_BASE_URL", "http://hindsight-api:8888")
	t.Setenv("PERSONAL_MEMORY_API_SECRET", "hindsight-secret")
	t.Setenv("PERSONAL_MEMORY_OWNER_SALT", "memory-salt")
	t.Setenv(
		"EXECUTION_CONTROL_RUNTIME_CONFIG_PATH",
		filepath.Join(repoRoot(t), "configs/runtime/execution-control/runtime-profile.staging.json"),
	)
}

func repoRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test file path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(file), "../../../../.."))
}
