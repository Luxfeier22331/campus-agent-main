package finalization

import (
	"context"
	"io"
	"log/slog"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
)

type ProductFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error

type FinalizationService struct {
	StateWriter executionapplication.FinalizationStateWriter
	*activityprojection.Writer
	PrepareMemoryDelivery     func(context.Context, execution.DurableRun) error
	ProductFinalizationWriter ProductFinalizationWriter
	FinalizationClient        executionapplication.ExecutionFinalizationClient
	AdmissionService          interface{ ValidateLocalToolContractFingerprintMap(map[string]any) error }
	Logger                    *slog.Logger
}

func New(service FinalizationService) *FinalizationService {
	if service.Logger == nil {
		service.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &service
}
