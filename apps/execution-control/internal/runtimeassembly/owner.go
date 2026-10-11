package runtimeassembly

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type resources struct {
	execution          executionResources
	memory             memoryResources
	temporalStarter    *temporalruntime.Starter
	temporalStarterErr error
	closeOnce          sync.Once
}

func newResources(cfg config.Config, logger *slog.Logger) (*resources, error) {
	ctx := context.Background()
	callbacks := outboundadapter.NewProductCallbackClient(cfg)
	execution := newExecutionResources(ctx, cfg, logger, callbacks)
	memory := newMemoryResources(ctx, cfg, callbacks)
	starter, starterErr := newTemporalStarter(ctx, cfg)
	return &resources{execution: execution, memory: memory, temporalStarter: starter, temporalStarterErr: starterErr}, nil
}

func (r *resources) Close() {
	r.closeOnce.Do(func() {
		if r.temporalStarter != nil {
			r.temporalStarter.Close()
		}
		if closer, ok := r.execution.store.(interface{ Close() }); ok {
			closer.Close()
		}
		if closer, ok := r.memory.store.(interface{ Close() }); ok {
			closer.Close()
		}
	})
}

func newTemporalStarter(ctx context.Context, cfg config.Config) (*temporalruntime.Starter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return NewStarter(connectCtx, temporalruntime.StarterOptions{
		ActivityTaskQueues:       []string{temporalruntime.ActivityTaskQueueCore, temporalruntime.ActivityTaskQueueAgent},
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}
