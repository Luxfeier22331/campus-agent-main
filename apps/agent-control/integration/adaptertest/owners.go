package adaptertest

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/answerstream"
	operationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"log/slog"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	finalizationapp "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/finalization"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
)

type ExecutionAdapter struct {
	*operationapp.RunProjectionService
	*operationapp.RuntimeInputService
	*operationapp.RuntimeResultBoundary
}
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
	RunProjectionStore        executionapplication.RunStore
}

type ProductFinalizationWriter = finalizationapp.ProductFinalizationWriter

func New(options Options) *Adapter {
	writer := activityprojection.New(activityprojection.Writer{WorkerID: options.Config.TemporalWorkerIdentity, RunProjectionStore: options.RunProjectionStore})
	inputReader := &executionapplication.InputReader{ExecutionInputLoader: options.ExecutionInputLoader, ExecutionInputErr: options.ExecutionInputError}
	answers, _ := options.RunProjectionStore.(answerstream.Publisher)
	projectionOwner := &operationapp.RunProjectionService{Answers: answers, StateWriter: options.RunProjectionStore, Writer: &activityprojection.Writer{WorkerID: writer.WorkerID, RunProjectionStore: writer.RunProjectionStore}, DeploymentRelease: options.Config.DeploymentRelease}
	executionOwner := &ExecutionAdapter{RunProjectionService: projectionOwner, RuntimeInputService: &operationapp.RuntimeInputService{Projection: projectionOwner, InputReader: inputReader, AnswerTransport: options.Config.AnswerTransport}, RuntimeResultBoundary: &operationapp.RuntimeResultBoundary{}}
	finalizationOwner := finalizationapp.New(finalizationapp.FinalizationService{StateWriter: options.RunProjectionStore, Writer: executionOwner.Writer, FinalizationClient: options.ProductCallbackClient, ProductFinalizationWriter: options.ProductFinalizationWriter, AdmissionService: options.AdmissionService, Logger: options.Logger})
	return &Adapter{AdmissionService: options.AdmissionService, Writer: writer, InputReader: inputReader, Config: options.Config, ExecutionAdapter: executionOwner, FinalizationAdapter: finalizationOwner}
}

func (a *Adapter) FinalizeExecutionCancellation(ctx context.Context, in executioncontract.CancellationInput) (executioncontract.CancellationOutput, error) {
	return a.FinalizeCancellation(ctx, in)
}
func (a *Adapter) FinalizeExecutionFailure(ctx context.Context, in executioncontract.FailureInput) (executioncontract.FailureOutput, error) {
	return a.FinalizationAdapter.FinalizeExecutionFailure(ctx, in)
}
func (a *Adapter) WriteWorkflowFinalization(ctx context.Context, in executioncontract.FinalizationInput) (executioncontract.FinalizationOutput, error) {
	return a.FinalizationAdapter.WriteWorkflowFinalization(ctx, in)
}
func (a *Adapter) SetProjectionStore(store executionapplication.RunStore) {
	a.RunProjectionStore = store
	if a.ExecutionAdapter != nil {
		a.ExecutionAdapter.RunProjectionStore = store
		a.ExecutionAdapter.StateWriter = store
	}
	if a.FinalizationAdapter != nil {
		a.FinalizationAdapter.RunProjectionStore = store
		a.StateWriter = store
	}
}
