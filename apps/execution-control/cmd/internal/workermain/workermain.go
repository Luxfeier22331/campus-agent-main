package workermain

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
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
	RoleWorkflow  Role = "workflow"
	RoleCore      Role = "activity-core"
	RoleAgent     Role = "activity-agent"
	RoleKnowledge Role = "activity-knowledge"
)

func Run(role Role) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if hasArg("--check-runtime") {
		if err := CheckRuntime(role); err != nil {
			logger.Error("campus execution worker runtime check failed", "role", string(role), "error", err.Error())
			os.Exit(1)
		}
		return
	}
	cfg, err := config.LoadFromEnvForRole(string(role))
	if err != nil {
		logger.Error("campus execution worker config invalid", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	workerTelemetry, err := newWorkerTelemetryRuntime(ctx, cfg, role, logger)
	if err != nil {
		logger.Error("campus execution worker telemetry invalid", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	defer shutdownWorkerTelemetry(workerTelemetry, cfg, logger)
	tracing, err := temporalruntime.NewTracingInterceptors(temporalruntime.TracingOptions{
		Enabled:      cfg.TemporalTracingEnabled,
		OTelEndpoint: cfg.OTelEndpoint,
		ServiceName:  cfg.OTelServiceName,
	})
	if err != nil {
		logger.Error("campus execution worker tracing invalid", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	temporalClient, err := client.DialContext(ctx, temporalClientOptions(cfg, tracing))
	if err != nil {
		logger.Error("campus execution worker temporal client failed", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	defer temporalClient.Close()
	runtimeWorker, err := buildWorker(role, cfg, temporalClient, tracing, workerTelemetry)
	if err != nil {
		logger.Error("campus execution worker invalid", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	if err := runtimeWorker.Start(); err != nil {
		logger.Error("campus execution worker start failed", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	defer runtimeWorker.Stop()
	logger.Info("campus execution worker started", "role", string(role), "worker_id", cfg.TemporalWorkerIdentity)
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals
	logger.Info("campus execution worker draining", "role", string(role))
	cancel()
}

func CheckRuntime(role Role) error {
	cfg, err := config.LoadFromEnvForRole(string(role))
	if err != nil {
		return err
	}
	tracing, err := temporalruntime.NewTracingInterceptors(temporalruntime.TracingOptions{
		Enabled:      cfg.TemporalTracingEnabled,
		OTelEndpoint: cfg.OTelEndpoint,
		ServiceName:  cfg.OTelServiceName,
	})
	if err != nil {
		return err
	}
	if _, err := workerOptionsForRole(cfg, role, tracing); err != nil {
		return err
	}
	_, err = taskQueueForRole(cfg, role)
	return err
}

func buildWorker(
	role Role,
	cfg config.Config,
	temporalClient client.Client,
	tracing temporalruntime.TracingInterceptors,
	workerTelemetry *workerTelemetryRuntime,
) (worker.Worker, error) {
	options, err := workerOptionsForRole(cfg, role, tracing)
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
		server := workerTelemetry.ActivityServer()
		return temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			server.TemporalContextActivities(),
			server.TemporalTypedToolActivities(),
			server.TemporalFinalizationActivities(),
			options,
		), nil
	case RoleAgent:
		server := workerTelemetry.ActivityServer()
		return temporalruntime.NewAgentActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			server.TemporalAgentActivities(),
			options,
		), nil
	case RoleKnowledge:
		server := workerTelemetry.ActivityServer()
		return temporalruntime.NewKnowledgeActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledge,
			server.TemporalKnowledgeActivities(),
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
) (worker.Options, error) {
	options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(role)))
	if err != nil {
		return worker.Options{}, err
	}
	return temporalruntime.ApplyTracingToWorkerOptions(options, tracing), nil
}

func taskQueueForRole(cfg config.Config, role Role) (string, error) {
	switch role {
	case RoleWorkflow:
		return cfg.TemporalTaskQueue, nil
	case RoleCore:
		return temporalruntime.ActivityTaskQueueCore, nil
	case RoleAgent:
		return temporalruntime.ActivityTaskQueueAgent, nil
	case RoleKnowledge:
		return temporalruntime.ActivityTaskQueueKnowledge, nil
	default:
		return "", fmt.Errorf("unsupported worker target %q", role)
	}
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

func newActivityServer(cfg config.Config) *httpapi.Server {
	return httpapi.NewServerWithDependencies(cfg, nil, nil, nil)
}

type workerTelemetryRuntime struct {
	server  *httpapi.Server
	emitter *telemetry.Emitter
}

func newWorkerTelemetryRuntime(
	ctx context.Context,
	cfg config.Config,
	role Role,
	logger *slog.Logger,
) (*workerTelemetryRuntime, error) {
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	if roleNeedsActivityServer(role) {
		server := newActivityServer(cfg)
		if err := ensureTemporalTracingExporter(cfg, server.TelemetryStatus()); err != nil {
			_ = server.Shutdown(ctx)
			return nil, err
		}
		return &workerTelemetryRuntime{server: server}, nil
	}
	emitter := telemetry.NewEmitter(ctx, cfg, logger)
	if err := ensureTemporalTracingExporter(cfg, emitter.Status()); err != nil {
		_ = emitter.Shutdown(ctx)
		return nil, err
	}
	return &workerTelemetryRuntime{emitter: emitter}, nil
}

func roleNeedsActivityServer(role Role) bool {
	return role != RoleWorkflow
}

func hasArg(want string) bool {
	for _, arg := range os.Args[1:] {
		if arg == want {
			return true
		}
	}
	return false
}

func ensureTemporalTracingExporter(cfg config.Config, status telemetry.Status) error {
	if cfg.TemporalTracingEnabled && !cfg.OTelEnabled {
		return fmt.Errorf("temporal tracing requires runtime profile otel.enabled=true")
	}
	if cfg.TemporalTracingEnabled && !status.ExporterConfigured {
		return fmt.Errorf("temporal tracing requires configured OTel trace exporter")
	}
	return nil
}

func (r *workerTelemetryRuntime) ActivityServer() *httpapi.Server {
	if r == nil {
		return nil
	}
	if r.server == nil {
		panic("activity server is not initialized for workflow-only worker telemetry runtime")
	}
	return r.server
}

func shutdownWorkerTelemetry(
	runtime *workerTelemetryRuntime,
	cfg config.Config,
	logger *slog.Logger,
) {
	timeout := time.Duration(cfg.ShutdownGraceMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if runtime == nil {
		return
	}
	if runtime.server != nil {
		if err := runtime.server.Shutdown(ctx); err != nil && logger != nil {
			logger.Warn("campus execution worker server shutdown failed", "error", err.Error())
		}
		return
	}
	if runtime.emitter != nil {
		if err := runtime.emitter.Shutdown(ctx); err != nil && logger != nil {
			logger.Warn("campus execution worker telemetry shutdown failed", "error", err.Error())
		}
	}
}
