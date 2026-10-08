package runtimeassembly

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	temporalexecution "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	temporalfinalization "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	temporalmemory "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/memory"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

type Role string

const (
	RoleWorkflow Role = "workflow"
	RoleCore     Role = "activity-core"
	RoleAgent    Role = "activity-agent"

	temporalWorkerStopTimeout = 350 * time.Second
)

type Runtime struct {
	client   client.Client
	metrics  *workerMetrics
	errors   chan error
	ready    atomic.Bool
	failed   atomic.Bool
	stopOnce sync.Once
	workers  []worker.Worker
}

type ActivitySets struct {
	Workflow     temporalexecution.Activities
	Context      temporalmemory.Activities
	Finalization temporalfinalization.Activities
}

func NewActivitySets(
	workflow temporalexecution.Activities,
	contextActivities temporalmemory.Activities,
	finalization temporalfinalization.Activities,
) ActivitySets {
	return ActivitySets{
		Workflow:     workflow,
		Context:      contextActivities,
		Finalization: finalization,
	}
}

func StartWorkers(
	startupContext context.Context,
	cfg config.Config,
	workflowActivities temporalexecution.Activities,
	contextActivities temporalmemory.Activities,
	finalizationActivities temporalfinalization.Activities,
	logger *slog.Logger,
) (*Runtime, error) {
	if workflowActivities == nil || contextActivities == nil || finalizationActivities == nil {
		return nil, fmt.Errorf("all activity owners are required for the worker runtime")
	}
	if startupContext == nil {
		startupContext = context.Background()
	}
	activitySets := NewActivitySets(workflowActivities, contextActivities, finalizationActivities)
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	metrics := newWorkerMetrics()
	options := temporalClientOptions(cfg)
	options.MetricsHandler = metrics.handler()
	temporalClient, err := client.DialContext(startupContext, options)
	if err != nil {
		return nil, fmt.Errorf("connect temporal client: %w", err)
	}

	runtime := &Runtime{
		client:  temporalClient,
		metrics: metrics,
		errors:  make(chan error, 1),
		workers: make([]worker.Worker, 0, 3),
	}
	for _, role := range []Role{RoleWorkflow, RoleCore, RoleAgent} {
		role := role
		runtimeWorker, buildErr := buildWorker(
			role,
			cfg,
			temporalClient,
			activitySets,
			func(fatalErr error) {
				runtime.failed.Store(true)
				logger.Error(
					"execution_control.worker_fatal",
					"event_type", "execution_control.worker_fatal",
					"status", "failed",
					"error_code", "worker_fatal",
					"role", string(role),
				)
				select {
				case runtime.errors <- fmt.Errorf("%s worker: %w", role, fatalErr):
				default:
				}
			},
		)
		if buildErr != nil {
			runtime.Stop()
			return nil, fmt.Errorf("build %s worker: %w", role, buildErr)
		}
		if startErr := runtimeWorker.Start(); startErr != nil {
			runtime.Stop()
			return nil, fmt.Errorf("start %s worker: %w", role, startErr)
		}
		runtime.workers = append(runtime.workers, runtimeWorker)
		logger.Info(
			"execution_control.worker_started",
			"event_type", "execution_control.worker_started",
			"status", "ready",
			"role", string(role),
		)
	}
	runtime.ready.Store(true)
	return runtime, nil
}

func (runtime *Runtime) Errors() <-chan error {
	return runtime.errors
}

func (runtime *Runtime) Stop() {
	if runtime == nil {
		return
	}
	runtime.stopOnce.Do(func() {
		runtime.ready.Store(false)
		var waitGroup sync.WaitGroup
		for _, runtimeWorker := range runtime.workers {
			waitGroup.Add(1)
			go func() {
				defer waitGroup.Done()
				runtimeWorker.Stop()
			}()
		}
		waitGroup.Wait()
		if runtime.client != nil {
			runtime.client.Close()
		}
	})
}

func buildWorker(
	role Role,
	cfg config.Config,
	temporalClient client.Client,
	activitySets ActivitySets,
	onFatalError func(error),
) (worker.Worker, error) {
	options, err := workerOptionsForRole(cfg, role, onFatalError)
	if err != nil {
		return nil, err
	}
	switch role {
	case RoleWorkflow:
		return NewWorkflowWorkerWithOptions(
			temporalClient,
			cfg.TemporalTaskQueue,
			options,
		), nil
	case RoleCore:
		return NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			activitySets.Context,
			activitySets.Finalization,
			options,
		), nil
	case RoleAgent:
		return NewWorkflowOperationActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			activitySets.Workflow,
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
	options, err := WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(role)))
	if err != nil {
		return worker.Options{}, err
	}
	options.OnFatalError = onFatalError
	options.WorkerStopTimeout = temporalWorkerStopTimeout
	return options, nil
}

func temporalWorkerProfile(cfg config.Config, role string) WorkerProfile {
	profile := cfg.WorkerProfiles[role]
	return WorkerProfile{
		ActivitySlots:                profile.ActivitySlots,
		ActivityTaskPollers:          profile.ActivityTaskPollers,
		TaskQueueActivitiesPerSecond: profile.TaskQueueActivitiesPerSecond,
		WorkerActivitiesPerSecond:    profile.WorkerActivitiesPerSecond,
		WorkflowTaskSlots:            profile.WorkflowTaskSlots,
		WorkflowTaskPollers:          profile.WorkflowTaskPollers,
	}
}

func (runtime *Runtime) Ready() bool {
	return runtime != nil && runtime.ready.Load() && !runtime.failed.Load()
}
func (runtime *Runtime) StartDraining() { runtime.ready.Store(false) }
