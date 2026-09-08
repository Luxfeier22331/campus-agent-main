package projection

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
)

type ProductFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error
type Writer struct {
	Config                    config.Config
	ExecutionInputLoader      execution.InputLoader
	ExecutionInputErr         error
	ProductFinalizationWriter ProductFinalizationWriter
	ProductCallbackClient     executionapplication.ProductCallbackClient
	RunProjectionStore        executionapplication.RunStore
}

func New(writer Writer) *Writer { return &writer }
