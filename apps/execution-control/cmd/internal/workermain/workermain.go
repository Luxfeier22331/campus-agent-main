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
	temporalClient, err := temporalruntime.NewTemporalClient(
		ctx,
		cfg.TemporalAddress,
		cfg.TemporalNamespace,
		cfg.TemporalWorkerIdentity,
	)
	if err != nil {
		logger.Error("campus execution worker temporal client failed", "role", string(role), "error", err.Error())
		os.Exit(1)
	}
	defer temporalClient.Close()
	runtimeWorker, err := buildWorker(role, cfg, temporalClient)
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

func buildWorker(role Role, cfg config.Config, temporalClient client.Client) (worker.Worker, error) {
	switch role {
	case RoleWorkflow:
		return temporalruntime.NewWorkflowWorker(temporalClient, cfg.TemporalTaskQueue), nil
	case RoleContext:
		server := newActivityServer(cfg)
		return temporalruntime.NewContextActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueContext,
			server.TemporalContextActivities(),
		), nil
	case RoleAgent:
		server := newActivityServer(cfg)
		return temporalruntime.NewAgentActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueAgent,
			server.TemporalAgentActivities(),
		), nil
	case RoleKnowledgePlan:
		server := newActivityServer(cfg)
		options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(RoleKnowledgePlan)))
		if err != nil {
			return nil, err
		}
		return temporalruntime.NewKnowledgePlanActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgePlan,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleKnowledgeRetrieval:
		server := newActivityServer(cfg)
		options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(RoleKnowledgeRetrieval)))
		if err != nil {
			return nil, err
		}
		return temporalruntime.NewKnowledgeRetrievalActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgeRetrieval,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleKnowledgeSynthesis:
		server := newActivityServer(cfg)
		options, err := temporalruntime.WorkerOptionsForProfile(temporalWorkerProfile(cfg, string(RoleKnowledgeSynthesis)))
		if err != nil {
			return nil, err
		}
		return temporalruntime.NewKnowledgeSynthesisActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
			server.TemporalKnowledgeActivities(),
			options,
		), nil
	case RoleCampusServices:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueCampusService,
			server.TemporalTypedToolActivities(),
		), nil
	case RoleNotice:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueNotice,
			server.TemporalTypedToolActivities(),
		), nil
	case RoleNavigation:
		server := newActivityServer(cfg)
		return temporalruntime.NewTypedToolActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueNavigation,
			server.TemporalTypedToolActivities(),
		), nil
	case RoleFinalization:
		server := newActivityServer(cfg)
		return temporalruntime.NewFinalizationActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueFinalization,
			server.TemporalFinalizationActivities(),
		), nil
	default:
		return nil, fmt.Errorf("unsupported worker role %q", role)
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
