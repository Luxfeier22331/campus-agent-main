package workermain

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Role string

const (
	RoleWorkflow           Role = "workflow"
	RoleContext            Role = "activity-context"
	RoleAgent              Role = "activity-agent"
	RoleKnowledgePlan      Role = "activity-knowledge-plan"
	RoleKnowledgeRetrieval Role = "activity-knowledge-retrieval"
	RoleKnowledgeSynthesis Role = "activity-knowledge-synthesis"
	RoleCampusServices     Role = "activity-campus-services"
	RoleNotice             Role = "activity-notice"
	RoleNavigation         Role = "activity-navigation"
	RoleFinalization       Role = "activity-finalization"
)

func Run(role Role) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.LoadFromEnvForRole(string(role))
	if err != nil {
		logger.Error("campus execution worker config invalid", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
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
	runtimeWorker, err := buildWorker(role, cfg, temporalClient, tracing)
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

func buildWorker(
	role Role,
	cfg config.Config,
	temporalClient client.Client,
	tracing temporalruntime.TracingInterceptors,
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
	case RoleContext:
		server := newActivityServer(cfg)
		return temporalruntime.NewContextActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueContext,
			server.TemporalContextActivities(),
			options,
		), nil
	case RoleAgent:
		server := newActivityServer(cfg)
		return temporalruntime.NewAgentActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			server.TemporalAgentActivities(),
			options,
		), nil
	case RoleKnowledgePlan:
		server := newActivityServer(cfg)
		return temporalruntime.NewKnowledgePlanActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgePlan,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleKnowledgeRetrieval:
		server := newActivityServer(cfg)
		return temporalruntime.NewKnowledgeRetrievalActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgeRetrieval,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleKnowledgeSynthesis:
		server := newActivityServer(cfg)
		return temporalruntime.NewKnowledgeSynthesisActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleCampusServices:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCampusService,
			server.TemporalTypedToolActivities(),
			options,
		), nil
	case RoleNotice:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueNotice,
			server.TemporalTypedToolActivities(),
			options,
		), nil
	case RoleNavigation:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueNavigation,
			server.TemporalTypedToolActivities(),
			options,
		), nil
	case RoleFinalization:
		server := newActivityServer(cfg)
		return temporalruntime.NewFinalizationActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueFinalization,
			server.TemporalFinalizationActivities(),
			options,
		), nil
	default:
		return nil, fmt.Errorf("unsupported worker role %q", role)
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
