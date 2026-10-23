package runtimeassembly

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalclient"
)

type resources struct {
	execution          executionResources
	temporalStarter    *temporalclient.Starter
	temporalStarterErr error
	closeOnce          sync.Once
}

func newResources(cfg config.Config, logger *slog.Logger) (*resources, error) {
	ctx := context.Background()
	callbacks := outboundadapter.NewProductCallbackClient(cfg)
	execution := newExecutionResources(ctx, cfg, logger, callbacks)
	starter, starterErr := newTemporalStarter(ctx, cfg)
	return &resources{execution: execution, temporalStarter: starter, temporalStarterErr: starterErr}, nil
}

func (r *resources) Close() {
	r.closeOnce.Do(func() {
		if r.temporalStarter != nil {
			r.temporalStarter.Close()
		}
		if closer, ok := r.execution.store.(interface{ Close() }); ok {
			closer.Close()
		}
	})
}

func newTemporalStarter(ctx context.Context, cfg config.Config) (*temporalclient.Starter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalclient.ErrTemporalStarterNotConfigured
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return NewStarter(connectCtx, temporalclient.StarterOptions{
		ActivityTaskQueues:       []string{"campus-agent.agent.model.v1", "campus-agent.agent.tool.v1"},
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}
