package workermain

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
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

	temporalWorkerStopTimeout = 50 * time.Second
)

type RuntimeWorkers struct {
	client   client.Client
	errors   chan error
	stopOnce sync.Once
	workers  []worker.Worker
}

func StartRuntimeWorkers(
	ctx context.Context,
	cfg config.Config,
	activityServer *httpapi.Server,
	logger *slog.Logger,
) (*RuntimeWorkers, error) {
	if activityServer == nil {
		return nil, fmt.Errorf("activity server is required for the combined runtime")
	}
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	if err := ensureTemporalTracingExporter(cfg, activityServer.TelemetryStatus()); err != nil {
		return nil, err
	}
	tracing, err := temporalruntime.NewTracingInterceptors(temporalruntime.TracingOptions{
		Enabled:      cfg.TemporalTracingEnabled,
		OTelEndpoint: cfg.OTelEndpoint,
		ServiceName:  cfg.OTelServiceName,
	})
	if err != nil {
		return nil, fmt.Errorf("configure worker tracing: %w", err)
	}
	temporalClient, err := client.DialContext(ctx, temporalClientOptions(cfg, tracing))
	if err != nil {
		return nil, fmt.Errorf("connect temporal client: %w", err)
	}

	runtimeWorkers := &RuntimeWorkers{
		client:  temporalClient,
		errors:  make(chan error, 1),
		workers: make([]worker.Worker, 0, 3),
	}
	for _, role := range []Role{RoleWorkflow, RoleCore, RoleAgent} {
		role := role
		runtimeWorker, buildErr := buildWorker(
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
				select {
				case runtimeWorkers.errors <- fmt.Errorf("%s worker: %w", role, fatalErr):
				default:
				}
			},
		)
		if buildErr != nil {
			runtimeWorkers.Stop()
			return nil, fmt.Errorf("build %s worker: %w", role, buildErr)
		}
		if startErr := runtimeWorker.Start(); startErr != nil {
			runtimeWorkers.Stop()
			return nil, fmt.Errorf("start %s worker: %w", role, startErr)
		}
		runtimeWorkers.workers = append(runtimeWorkers.workers, runtimeWorker)
		logger.Info(
			"campus execution worker started",
			"role", string(role),
			"worker_id", cfg.TemporalWorkerIdentity,
		)
	}
	return runtimeWorkers, nil
}

func (runtimeWorkers *RuntimeWorkers) Errors() <-chan error {
	return runtimeWorkers.errors
}

func (runtimeWorkers *RuntimeWorkers) Stop() {
	if runtimeWorkers == nil {
		return
	}
	runtimeWorkers.stopOnce.Do(func() {
		var waitGroup sync.WaitGroup
		for _, runtimeWorker := range runtimeWorkers.workers {
			waitGroup.Add(1)
			go func() {
				defer waitGroup.Done()
				runtimeWorker.Stop()
			}()
		}
		waitGroup.Wait()
		if runtimeWorkers.client != nil {
			runtimeWorkers.client.Close()
		}
	})
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
	options.WorkerStopTimeout = temporalWorkerStopTimeout
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

func ensureTemporalTracingExporter(cfg config.Config, status telemetry.Status) error {
	if cfg.TemporalTracingEnabled && !status.ExporterConfigured {
		return fmt.Errorf("temporal tracing requires configured OTel trace exporter")
	}
	return nil
}
