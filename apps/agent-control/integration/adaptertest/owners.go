package adaptertest

import (
	"context"
	"log/slog"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalizationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	operationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	appprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	executionactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/execution"
	finalizationactivities "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/finalization"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporaladapter/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/temporalruntime"
)

type ExecutionAdapter = operationapp.OperationService
type FinalizationAdapter = finalizationapp.FinalizationService
type Adapter struct {
	*activityprojection.Writer
	*executionapplication.InputReader
	Config           config.Config
	AdmissionService execution.AdmissionService
	*ExecutionAdapter
	*FinalizationAdapter
}
type Options struct {
	Config                    config.Config
	AdmissionService          execution.AdmissionService
	ExecutionInputLoader      execution.InputLoader
	ExecutionInputError       error
	Logger                    *slog.Logger
	ProductFinalizationWriter finalizationapp.ProductFinalizationWriter
	ProductCallbackClient     executionapplication.ExecutionFinalizationClient
	AgentRuntimeClient        executionapplication.AgentRuntimeClient
	RunProjectionStore        executionapplication.RunStore
	ReceiptStore              executionapplication.ReceiptStore
}

type ProductFinalizationWriter = finalizationapp.ProductFinalizationWriter

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
	finalizationOwner := finalizationapp.New(finalizationapp.FinalizationService{StateWriter: options.RunProjectionStore, Writer: executionOwner.Writer, FinalizationClient: options.ProductCallbackClient, ProductFinalizationWriter: options.ProductFinalizationWriter, AdmissionService: options.AdmissionService, Logger: options.Logger})
	return &Adapter{AdmissionService: options.AdmissionService, Writer: writer, InputReader: inputReader, Config: options.Config, ExecutionAdapter: executionOwner, FinalizationAdapter: finalizationOwner}
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
