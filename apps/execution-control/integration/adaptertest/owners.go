package adaptertest

import (
	"context"
	"log/slog"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	finalizationapp "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/finalization"
	operationapp "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/operation"
	appprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/answermemory"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/execution"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization"
	memoryactivities "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/memory"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
)

type ExecutionAdapter = operationapp.OperationService
type MemoryAdapter = memoryactivities.Adapter
type FinalizationAdapter = finalizationapp.FinalizationService
type Adapter struct {
	*activityprojection.Writer
	*executionapplication.InputReader
	Config           config.Config
	AdmissionService execution.AdmissionService
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
	PersonalMemoryExecutor    PersonalMemoryExecutor
	PersonalMemoryError       error
	PersonalMemoryStateStore  memoryapplication.MemoryStateStore
	PersonalMemoryStateError  error
	ProductFinalizationWriter finalizationapp.ProductFinalizationWriter
	ProductCallbackClient     interface {
		executionapplication.ExecutionFinalizationClient
		memoryapplication.MemoryCommandResultClient
	}
	AgentRuntimeClient executionapplication.AgentRuntimeClient
	RunProjectionStore executionapplication.RunStore
	ReceiptStore       executionapplication.ReceiptStore
}

type ProductFinalizationWriter = finalizationapp.ProductFinalizationWriter

type PersonalMemoryExecutor interface {
	memoryapplication.MemoryRecaller
	memoryapplication.MemoryCommandExecutor
}

func (a *Adapter) SetPersonalMemoryExecutor(executor PersonalMemoryExecutor) {
	a.CommandExecutor = executor
	a.Recaller = executor
}

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
	writer := activityprojection.New(activityprojection.Writer{WorkerID: options.Config.TemporalWorkerIdentity, RunProjectionStore: options.RunProjectionStore})
	inputReader := &executionapplication.InputReader{ExecutionInputLoader: options.ExecutionInputLoader, ExecutionInputErr: options.ExecutionInputError}
	executionOwner := &operationapp.OperationService{StateWriter: options.RunProjectionStore, Writer: &appprojection.Writer{WorkerID: writer.WorkerID, RunProjectionStore: writer.RunProjectionStore}, InputReader: inputReader, Options: operationOptions(options.Config), AgentRuntimeClient: options.AgentRuntimeClient, Receipts: executionapplication.NewReceiptService(receiptStore)}
	memoryService := &memoryapplication.Service{CommandExecutor: options.PersonalMemoryExecutor, Recaller: options.PersonalMemoryExecutor, PersonalMemoryErr: options.PersonalMemoryError, CommandStateStore: options.PersonalMemoryStateStore, CallLeaseStore: options.PersonalMemoryStateStore, OwnerLifecycleStore: options.PersonalMemoryStateStore, PersonalMemoryStateErr: options.PersonalMemoryStateError, OwnerSalt: options.Config.PersonalMemoryOwnerSalt, TimeoutSeconds: options.Config.PersonalMemoryTimeoutSeconds}
	memoryOwner := memoryactivities.New(memoryactivities.Adapter{Service: memoryService, AnswerAppend: &answermemory.Bridge{Writer: writer, InputReader: inputReader}, MemoryResultClient: options.ProductCallbackClient})
	finalizationOwner := finalizationapp.New(finalizationapp.FinalizationService{StateWriter: options.RunProjectionStore, Writer: executionOwner.Writer, FinalizationClient: options.ProductCallbackClient, ProductFinalizationWriter: options.ProductFinalizationWriter, AdmissionService: options.AdmissionService, Logger: options.Logger})
	return &Adapter{AdmissionService: options.AdmissionService, Writer: writer, InputReader: inputReader, Config: options.Config, ExecutionAdapter: executionOwner, MemoryAdapter: memoryOwner, FinalizationAdapter: finalizationOwner}
}

func operationOptions(cfg config.Config) operationapp.Options {
	return operationapp.Options{AnswerTransport: cfg.AnswerTransport, Configured: strings.TrimSpace(cfg.AgentRuntimeBaseURL) != "" && strings.TrimSpace(cfg.AgentRuntimeSharedSecret) != "", DeploymentRelease: cfg.DeploymentRelease}
}
func NewExecutionAdapter(a *Adapter) *executionactivities.Adapter {
	if a.ExecutionAdapter == nil {
		a.ExecutionAdapter = &operationapp.OperationService{Writer: &appprojection.Writer{}, InputReader: a.InputReader}
	}
	if a.Writer != nil {
		a.ExecutionAdapter.RunProjectionStore = a.RunProjectionStore
		a.ExecutionAdapter.WorkerID = a.WorkerID
	}
	a.Options = operationOptions(a.Config)
	return executionactivities.New(executionactivities.Adapter{Service: a.ExecutionAdapter})
}
func NewFinalizationAdapter(a *Adapter) *finalizationactivities.Adapter {
	if a.FinalizationAdapter == nil {
		a.FinalizationAdapter = finalizationapp.New(finalizationapp.FinalizationService{Writer: &appprojection.Writer{}})
	}
	if a.Writer != nil {
		a.FinalizationAdapter.RunProjectionStore = a.RunProjectionStore
		a.FinalizationAdapter.WorkerID = a.WorkerID
	}
	return finalizationactivities.New(finalizationactivities.Adapter{Service: a.FinalizationAdapter})
}
func NewMemoryAdapter(a *Adapter) *MemoryAdapter {
	if a.MemoryAdapter == nil {
		ms := &memoryapplication.Service{OwnerSalt: a.Config.PersonalMemoryOwnerSalt, TimeoutSeconds: a.Config.PersonalMemoryTimeoutSeconds}
		return memoryactivities.New(memoryactivities.Adapter{Service: ms, AnswerAppend: &answermemory.Bridge{Writer: a.Writer, InputReader: a.InputReader}})
	}
	return a.MemoryAdapter
}
func (a *Adapter) SolveTask(ctx context.Context, in temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return NewExecutionAdapter(a).SolveTask(ctx, in)
}
func (a *Adapter) SolveTaskActivity(ctx context.Context, in temporalruntime.SolveTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SolveTask(ctx, in)
}
func (a *Adapter) ExecuteTaskStep(ctx context.Context, in temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return NewExecutionAdapter(a).ExecuteTaskStep(ctx, in)
}
func (a *Adapter) ExecuteTaskStepActivity(ctx context.Context, in temporalruntime.ExecuteTaskStepActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ExecuteTaskStep(ctx, in)
}
func (a *Adapter) ReplanTask(ctx context.Context, in temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return NewExecutionAdapter(a).ReplanTask(ctx, in)
}
func (a *Adapter) ReplanTaskActivity(ctx context.Context, in temporalruntime.ReplanTaskActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ReplanTask(ctx, in)
}
func (a *Adapter) SynthesizeAnswer(ctx context.Context, in temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return NewExecutionAdapter(a).SynthesizeAnswer(ctx, in)
}
func (a *Adapter) SynthesizeAnswerActivity(ctx context.Context, in temporalruntime.SynthesizeAnswerActivityInput) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SynthesizeAnswer(ctx, in)
}
func (a *Adapter) FinalizeExecutionCancellation(ctx context.Context, in temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return NewFinalizationAdapter(a).FinalizeExecutionCancellation(ctx, in)
}
func (a *Adapter) FinalizeExecutionCancellationActivity(ctx context.Context, in temporalruntime.FinalizeExecutionCancellationActivityInput) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return a.FinalizeExecutionCancellation(ctx, in)
}
func (a *Adapter) FinalizeExecutionFailure(ctx context.Context, in temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return NewFinalizationAdapter(a).FinalizeExecutionFailure(ctx, in)
}
func (a *Adapter) FinalizeExecutionFailureActivity(ctx context.Context, in temporalruntime.FinalizeExecutionFailureActivityInput) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return a.FinalizeExecutionFailure(ctx, in)
}
func (a *Adapter) WriteWorkflowFinalization(ctx context.Context, in temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return NewFinalizationAdapter(a).WriteWorkflowFinalization(ctx, in)
}
func (a *Adapter) WriteWorkflowFinalizationActivity(ctx context.Context, in temporalruntime.WriteWorkflowFinalizationActivityInput) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return a.WriteWorkflowFinalization(ctx, in)
}

func (a *Adapter) SetProjectionStore(store executionapplication.RunStore) {
	a.RunProjectionStore = store
	if a.ExecutionAdapter != nil {
		a.ExecutionAdapter.RunProjectionStore = store
		a.ExecutionAdapter.StateWriter = store
	}
	if a.FinalizationAdapter != nil {
		a.FinalizationAdapter.RunProjectionStore = store
		a.FinalizationAdapter.StateWriter = store
	}
}
