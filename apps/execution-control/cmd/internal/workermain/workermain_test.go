package workermain

import (
	"context"
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
			TemporalWorkerIdentity: "staging:activity-core:001",
		},
		tracing,
	)

	if options.HostPort != "temporal:7233" {
		t.Fatalf("host port = %q, want temporal:7233", options.HostPort)
	}
	if options.Namespace != "campus-agent-staging" {
		t.Fatalf("namespace = %q, want campus-agent-staging", options.Namespace)
	}
	if options.Identity != "staging:activity-core:001" {
		t.Fatalf("identity = %q, want staging:activity-core:001", options.Identity)
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
				string(RoleAgent): {
					ActivitySlots:       3,
					ActivityTaskPollers: 2,
				},
			},
		},
		RoleAgent,
		tracing,
		func(error) {},
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
	if options.OnFatalError == nil {
		t.Fatal("worker fatal error callback is not configured")
	}
	if options.WorkerStopTimeout != 50*time.Second {
		t.Fatalf("worker stop timeout = %s, want 50s", options.WorkerStopTimeout)
	}
}

func TestWorkerOptionsForRoleAppliesTracingToUnprofiledWorkers(t *testing.T) {
	tracing := mustTracingInterceptors(t)

	options, err := workerOptionsForRole(config.Config{}, RoleCore, tracing, func(error) {})
	if err != nil {
		t.Fatalf("workerOptionsForRole returned error: %v", err)
	}

	if len(options.Interceptors) != 1 {
		t.Fatalf("worker interceptors = %d, want 1", len(options.Interceptors))
	}
}

func TestNewWorkflowTelemetryInstallsProviderBeforeTracing(t *testing.T) {
	otel.SetTracerProvider(noop.NewTracerProvider())
	t.Cleanup(func() {
		otel.SetTracerProvider(noop.NewTracerProvider())
	})

	emitter, err := newWorkflowTelemetry(
		context.Background(),
		config.Config{
			OTelEnabled:                  true,
			OTelEndpoint:                 "http://collector:4318/v1/traces",
			OTelServiceName:              "campus-execution-control",
			OTelExportTimeoutMS:          int(time.Second / time.Millisecond),
			OTelAllowedAttributesVersion: "execution-control-otel-attrs-v1",
			TemporalTracingEnabled:       true,
		},
		nil,
	)
	if err != nil {
		t.Fatalf("newWorkflowTelemetry returned error: %v", err)
	}
	t.Cleanup(func() {
		shutdownWorkerRuntime(nil, emitter, config.Config{ShutdownGraceMS: 1000}, nil)
	})

	if _, ok := otel.GetTracerProvider().(noop.TracerProvider); ok {
		t.Fatal("global OTel tracer provider is still noop after worker telemetry bootstrap")
	}
}

func TestNewWorkflowTelemetryRejectsTemporalTracingWithoutOTel(t *testing.T) {
	_, err := newWorkflowTelemetry(
		context.Background(),
		config.Config{
			TemporalTracingEnabled: true,
		},
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
