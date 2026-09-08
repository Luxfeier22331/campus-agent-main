package adaptertest

import (
	"log/slog"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	memoryactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/memory"
)

type ExecutionAdapter = executionactivities.Adapter
type MemoryAdapter = memoryactivities.Adapter
type FinalizationAdapter = finalizationactivities.Adapter
type Adapter struct {
	*activityprojection.Writer
	*ExecutionAdapter
	*MemoryAdapter
	*FinalizationAdapter
}
type Options struct {
	Config                    config.Config
	AdmissionService          execution.AdmissionService
	ExecutionInputLoader      execution.InputLoader
	ExecutionInputError       error
	Logger                    *slog.Logger
	PersonalMemoryExecutor    executionapplication.MemoryExecutor
	PersonalMemoryError       error
	PersonalMemoryStateStore  executionapplication.MemoryStore
	PersonalMemoryStateError  error
	ProductFinalizationWriter activityprojection.ProductFinalizationWriter
	ProductCallbackClient     executionapplication.ProductCallbackClient
	AgentRuntimeClient        executionapplication.AgentRuntimeClient
	RunProjectionStore        executionapplication.RunStore
	ReceiptStore              executionapplication.ReceiptStore
}

type ProductFinalizationWriter = activityprojection.ProductFinalizationWriter

func New(options Options) *Adapter {
	receiptStore := options.ReceiptStore
	if receiptStore == nil {
		switch store := options.RunProjectionStore.(type) {
		case *executionpersistence.InMemoryRunProjectionStore:
			receiptStore = store.Receipts
		case *executionpersistence.PostgresRunProjectionStore:
			receiptStore = store.Receipts
		}
	}
	// execution
	// memory
	// finalization
	writer := activityprojection.New(activityprojection.Writer{Config: options.Config, ExecutionInputLoader: options.ExecutionInputLoader, ExecutionInputErr: options.ExecutionInputError, ProductFinalizationWriter: options.ProductFinalizationWriter, ProductCallbackClient: options.ProductCallbackClient, RunProjectionStore: options.RunProjectionStore})
	executionOwner := executionactivities.New(executionactivities.Adapter{Writer: writer, AgentRuntimeClient: options.AgentRuntimeClient, Receipts: executionapplication.NewReceiptService(receiptStore)})
	memoryOwner := memoryactivities.New(memoryactivities.Adapter{Writer: writer, PersonalMemoryExecutor: options.PersonalMemoryExecutor, PersonalMemoryErr: options.PersonalMemoryError, PersonalMemoryStateStore: options.PersonalMemoryStateStore, PersonalMemoryStateErr: options.PersonalMemoryStateError})
	finalizationOwner := finalizationactivities.New(finalizationactivities.Adapter{Writer: writer, AdmissionService: options.AdmissionService, Logger: options.Logger})
	return &Adapter{Writer: writer, ExecutionAdapter: executionOwner, MemoryAdapter: memoryOwner, FinalizationAdapter: finalizationOwner}
}
func NewExecutionAdapter(a *Adapter) *ExecutionAdapter {
	if a.ExecutionAdapter == nil {
		return executionactivities.New(executionactivities.Adapter{Writer: a.Writer})
	}
	return a.ExecutionAdapter
}
func NewMemoryAdapter(a *Adapter) *MemoryAdapter {
	if a.MemoryAdapter == nil {
		return memoryactivities.New(memoryactivities.Adapter{Writer: a.Writer})
	}
	return a.MemoryAdapter
}
func NewFinalizationAdapter(a *Adapter) *FinalizationAdapter {
	if a.FinalizationAdapter == nil {
		return finalizationactivities.New(finalizationactivities.Adapter{Writer: a.Writer})
	}
	return a.FinalizationAdapter
}
