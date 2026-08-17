package runtimeassembly

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
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/finalizationactivity"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryactivity"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/primaryagentactivity"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Role string

const (
	RoleWorkflow Role = "workflow"
	RoleCore     Role = "activity-core"
	RoleAgent    Role = "activity-agent"

	temporalWorkerStopTimeout = 50 * time.Second
)

type Runtime struct {
	client     client.Client
	errors     chan error
	reconciler *executionreconciler.Reconciler
	stopOnce   sync.Once
	workers    []worker.Worker
}

type ActivityHandlers interface {
	primaryagentactivity.Handler
	memoryactivity.Handler
	finalizationactivity.Handler
}

type ActivitySets struct {
	Agent        temporalruntime.AgentActivities
	Context      temporalruntime.ContextActivities
	Finalization temporalruntime.FinalizationActivities
}

func NewActivitySets(handlers ActivityHandlers) ActivitySets {
	return ActivitySets{
		Agent:        primaryagentactivity.New(handlers),
		Context:      memoryactivity.New(handlers),
		Finalization: finalizationactivity.New(handlers),
	}
}

func StartRuntime(
	ctx context.Context,
	cfg config.Config,
	activityHandlers ActivityHandlers,
	reconciler *executionreconciler.Reconciler,
	logger *slog.Logger,
) (*Runtime, error) {
	if activityHandlers == nil {
		return nil, fmt.Errorf("activity handlers are required for the combined runtime")
	}
	if reconciler == nil {
		return nil, fmt.Errorf("execution reconciler is required for the combined runtime")
	}
	activitySets := NewActivitySets(activityHandlers)
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	temporalClient, err := client.DialContext(ctx, temporalClientOptions(cfg))
	if err != nil {
		return nil, fmt.Errorf("connect temporal client: %w", err)
	}

	runtime := &Runtime{
		client:     temporalClient,
		errors:     make(chan error, 1),
		reconciler: reconciler,
		workers:    make([]worker.Worker, 0, 3),
	}
	for _, role := range []Role{RoleWorkflow, RoleCore, RoleAgent} {
		role := role
		runtimeWorker, buildErr := buildWorker(
			role,
			cfg,
			temporalClient,
			activitySets,
			func(fatalErr error) {
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
	reconciler.Start(ctx)
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
		if runtime.reconciler != nil {
			runtime.reconciler.Stop()
		}
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
		return temporalruntime.NewWorkflowWorkerWithOptions(
			temporalClient,
			cfg.TemporalTaskQueue,
			options,
		), nil
	case RoleCore:
		return temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			activitySets.Context,
			activitySets.Finalization,
			options,
		), nil
	case RoleAgent:
		return temporalruntime.NewAgentActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			activitySets.Agent,
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
