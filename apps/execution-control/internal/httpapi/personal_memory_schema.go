package httpapi

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func EnsurePersonalMemorySchema(ctx context.Context, cfg config.Config) error {
	executor, err := newPersonalMemoryExecutor(cfg)
	if err != nil {
		return err
	}
	return executor.EnsureSchema(ctx)
}

func CheckPersonalMemorySchema(ctx context.Context, cfg config.Config) error {
	executor, err := newPersonalMemoryExecutor(cfg)
	if err != nil {
		return err
	}
	return executor.HealthCheck(ctx)
}
