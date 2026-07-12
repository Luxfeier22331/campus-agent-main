package workermain

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Role string

const (
	RoleWorkflow Role = "workflow"
	RoleCore     Role = "activity-core"
	RoleAgent    Role = "activity-agent"
)

func Run(role Role) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(role, logger); err != nil {
		logger.Error("campus execution worker stopped", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
}

func run(role Role, logger *slog.Logger) error {
	cfg, err := config.LoadFromEnvForRole(string(role))
	if err != nil {
		return fmt.Errorf("load worker config: %w", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var activityServer *httpapi.Server
	var workflowTelemetry *telemetry.Emitter
	if roleNeedsActivityServer(role) {
		activityServer, err = newActivityRuntime(ctx, cfg, role)
	} else {
		workflowTelemetry, err = newWorkflowTelemetry(ctx, cfg, logger)
	}
	if err != nil {
		return err
	}
	defer shutdownWorkerRuntime(activityServer, workflowTelemetry, cfg, logger)
	tracing, err := temporalruntime.NewTracingInterceptors(temporalruntime.TracingOptions{
		Enabled:      cfg.TemporalTracingEnabled,
		OTelEndpoint: cfg.OTelEndpoint,
		ServiceName:  cfg.OTelServiceName,
	})
	if err != nil {
		return fmt.Errorf("configure worker tracing: %w", err)
	}
	temporalClient, err := client.DialContext(ctx, temporalClientOptions(cfg, tracing))
	if err != nil {
		return fmt.Errorf("connect temporal client: %w", err)
	}
	defer temporalClient.Close()
	runtimeWorker, err := buildWorker(
		role,
		cfg,
		temporalClient,
		tracing,
		activityServer,
		func(fatalErr error) {
			logger.Error(
				"campus execution worker fatal error",
				"role", string(role),
				"error", fatalErr.Error(),
			)
		},
	)
	if err != nil {
		return fmt.Errorf("build temporal worker: %w", err)
	}
	logger.Info("campus execution worker starting", "role", string(role), "worker_id", cfg.TemporalWorkerIdentity)
	if err := runtimeWorker.Run(worker.InterruptCh()); err != nil {
		return fmt.Errorf("run temporal worker: %w", err)
	}
	logger.Info("campus execution worker stopped", "role", string(role))
	return nil
}

func buildWorker(
	role Role,
	cfg config.Config,
	temporalClient client.Client,
	tracing temporalruntime.TracingInterceptors,
	activityServer *httpapi.Server,
	onFatalError func(error),
) (worker.Worker, error) {
	options, err := workerOptionsForRole(cfg, role, tracing, onFatalError)
	if err != nil {
		return nil, err
	}
	switch role {
	case RoleWorkflow:
		return temporalruntime.NewWorkflowWorkerWithOptions(
			temporalClient,
			cfg.TemporalTaskQueue,
			options,
		), nil
	case RoleCore:
		if activityServer == nil {
			return nil, fmt.Errorf("activity server is required for core worker")
		}
		return temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			activityServer.TemporalContextActivities(),
			activityServer.TemporalFinalizationActivities(),
			options,
		), nil
	case RoleAgent:
		if activityServer == nil {
			return nil, fmt.Errorf("activity server is required for agent worker")
		}
		return temporalruntime.NewAgentActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			activityServer.TemporalAgentActivities(),
			options,
		), nil
	default:
		return nil, fmt.Errorf("unsupported worker target %q", role)
	}
}

func temporalClientOptions(
	cfg config.Config,
	tracing temporalruntime.TracingInterceptors,
) client.Options {
	return temporalruntime.ApplyTracingToClientOptions(client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
		Identity:  cfg.TemporalWorkerIdentity,
	}, tracing)
}

func workerOptionsForRole(
	cfg config.Config,
	role Role,
	tracing temporalruntime.TracingInterceptors,
	onFatalError func(error),
) (worker.Options, error) {
	options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(role)))
	if err != nil {
		return worker.Options{}, err
	}
	options = temporalruntime.ApplyTracingToWorkerOptions(options, tracing)
	options.OnFatalError = onFatalError
	return options, nil
}

func temporalWorkerProfile(cfg config.Config, role string) temporalruntime.WorkerProfile {
	profile := cfg.WorkerProfiles[role]
	return temporalruntime.WorkerProfile{
		ActivitySlots:                profile.ActivitySlots,
		ActivityTaskPollers:          profile.ActivityTaskPollers,
		TaskQueueActivitiesPerSecond: profile.TaskQueueActivitiesPerSecond,
		WorkerActivitiesPerSecond:    profile.WorkerActivitiesPerSecond,
		WorkflowTaskSlots:            profile.WorkflowTaskSlots,
		WorkflowTaskPollers:          profile.WorkflowTaskPollers,
	}
}

func newActivityRuntime(
	ctx context.Context,
	cfg config.Config,
	role Role,
) (*httpapi.Server, error) {
	var activityRole httpapi.TemporalActivityRuntimeRole
	switch role {
	case RoleCore:
		activityRole = httpapi.TemporalActivityRuntimeRoleCore
	case RoleAgent:
		activityRole = httpapi.TemporalActivityRuntimeRoleAgent
	default:
		return nil, fmt.Errorf("unsupported activity runtime role %q", role)
	}
	server, err := httpapi.NewTemporalActivityServer(cfg, activityRole)
	if err != nil {
		return nil, err
	}
	if err := ensureTemporalTracingExporter(cfg, server.TelemetryStatus()); err != nil {
		_ = server.Shutdown(ctx)
		return nil, err
	}
	return server, nil
}

func newWorkflowTelemetry(
	ctx context.Context,
	cfg config.Config,
	logger *slog.Logger,
) (*telemetry.Emitter, error) {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	emitter := telemetry.NewEmitter(ctx, cfg, logger)
	if err := ensureTemporalTracingExporter(cfg, emitter.Status()); err != nil {
		_ = emitter.Shutdown(ctx)
		return nil, err
	}
	return emitter, nil
}

func roleNeedsActivityServer(role Role) bool {
	return role != RoleWorkflow
}

func ensureTemporalTracingExporter(cfg config.Config, status telemetry.Status) error {
	if cfg.TemporalTracingEnabled && !cfg.OTelEnabled {
		return fmt.Errorf("temporal tracing requires runtime config otel.enabled=true")
	}
	if cfg.TemporalTracingEnabled && !status.ExporterConfigured {
		return fmt.Errorf("temporal tracing requires configured OTel trace exporter")
	}
	return nil
}

func shutdownWorkerRuntime(
	activityServer *httpapi.Server,
	workflowTelemetry *telemetry.Emitter,
	cfg config.Config,
	logger *slog.Logger,
) {
	timeout := time.Duration(cfg.ShutdownGraceMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if activityServer != nil {
		if err := activityServer.Shutdown(ctx); err != nil && logger != nil {
			logger.Warn("campus execution worker server shutdown failed", "error", err.Error())
		}
	}
	if workflowTelemetry != nil {
		if err := workflowTelemetry.Shutdown(ctx); err != nil && logger != nil {
			logger.Warn("campus execution worker telemetry shutdown failed", "error", err.Error())
		}
	}
}
