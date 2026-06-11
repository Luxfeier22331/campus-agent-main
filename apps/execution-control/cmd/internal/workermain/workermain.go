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
	RoleWorkflow       Role = "workflow"
	RoleContext        Role = "activity-context"
	RoleKnowledge      Role = "activity-knowledge"
	RoleCampusServices Role = "activity-campus-services"
	RoleNotice         Role = "activity-notice"
	RoleNavigation     Role = "activity-navigation"
	RoleFinalization   Role = "activity-finalization"
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
	case RoleKnowledge:
		server := newActivityServer(cfg)
		return temporalruntime.NewKnowledgeActivityWorker(
			temporalClient,
			temporalruntime.ActivityTaskQueueKnowledge,
			server.TemporalKnowledgeActivities(),
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

func newActivityServer(cfg config.Config) *httpapi.Server {
	return httpapi.NewServerWithDependencies(cfg, nil, nil, nil)
}
