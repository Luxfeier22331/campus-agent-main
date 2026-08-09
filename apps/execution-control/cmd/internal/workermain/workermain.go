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
	temporalClient, err := client.DialContext(ctx, temporalClientOptions(cfg))
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
			activityServer,
			func(fatalErr error) {
				logger.Error(
					"execution_control.worker_fatal",
					"event_type", "execution_control.worker_fatal",
					"status", "failed",
					"error_code", "worker_fatal",
					"role", string(role),
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
			"execution_control.worker_started",
			"event_type", "execution_control.worker_started",
			"status", "ready",
			"role", string(role),
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
	activityServer *httpapi.Server,
	onFatalError func(error),
) (worker.Worker, error) {
	options, err := workerOptionsForRole(cfg, role, onFatalError)
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

func temporalClientOptions(cfg config.Config) client.Options {
	return client.Options{
		HostPort:  cfg.TemporalAddress,
		Namespace: cfg.TemporalNamespace,
		Identity:  cfg.TemporalWorkerIdentity,
	}
}

func workerOptionsForRole(
	cfg config.Config,
	role Role,
	onFatalError func(error),
) (worker.Options, error) {
	options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(role)))
	if err != nil {
		return worker.Options{}, err
	}
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
