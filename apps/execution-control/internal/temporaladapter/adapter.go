package temporaladapter

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

// ProductFinalizationWriter is the application boundary used by Temporal
// activities to commit a product terminal state. The adapter does not know
// the HTTP transport or the product persistence implementation.
type ProductFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error

type Options struct {
	Config                    config.Config
	AdmissionService          execution.AdmissionService
	ExecutionInputLoader      execution.InputLoader
	ExecutionInputError       error
	Logger                    *slog.Logger
	PersonalMemoryExecutor    memoryruntime.Executor
	PersonalMemoryError       error
	PersonalMemoryStateStore  memoryruntime.StateStore
	PersonalMemoryStateError  error
	ProductFinalizationWriter ProductFinalizationWriter
	ProductCallbackClient     outboundadapter.ProductCallbackClient
	AgentRuntimeClient        outboundadapter.AgentRuntimeClient
	RunProjectionStore        execution.RunProjectionStore
}

type Adapter struct {
	admissionService          execution.AdmissionService
	config                    config.Config
	executionInputLoader      execution.InputLoader
	executionInputErr         error
	logger                    *slog.Logger
	personalMemoryExecutor    memoryruntime.Executor
	personalMemoryErr         error
	personalMemoryStateStore  memoryruntime.StateStore
	personalMemoryStateErr    error
	productFinalizationWriter ProductFinalizationWriter
	productCallbackClient     outboundadapter.ProductCallbackClient
	agentRuntimeClient        outboundadapter.AgentRuntimeClient
	runProjectionStore        execution.RunProjectionStore
}

// The adapter itself is the Temporal activity set. Keeping registration
// methods on the concrete adapter avoids a second forwarding owner between
// Temporal and the execution application.
func (a *Adapter) SolveTaskActivity(
	ctx context.Context,
	input temporalruntime.SolveTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SolveTask(ctx, input)
}

func (a *Adapter) ExecuteTaskStepActivity(
	ctx context.Context,
	input temporalruntime.ExecuteTaskStepActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ExecuteTaskStep(ctx, input)
}

func (a *Adapter) ReplanTaskActivity(
	ctx context.Context,
	input temporalruntime.ReplanTaskActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.ReplanTask(ctx, input)
}

func (a *Adapter) SynthesizeAnswerActivity(
	ctx context.Context,
	input temporalruntime.SynthesizeAnswerActivityInput,
) (temporalruntime.WorkflowOperationActivityOutput, error) {
	return a.SynthesizeAnswer(ctx, input)
}

func (a *Adapter) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return a.AppendConversationMemory(ctx, input)
}

func (a *Adapter) ExecutePersonalMemoryCommandActivity(
	ctx context.Context,
	input memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.ExecutePersonalMemoryCommand(ctx, input)
}

func (a *Adapter) FinalizePersonalMemoryCommandReceiptActivity(
	ctx context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.FinalizePersonalMemoryCommandReceipt(ctx, input)
}

func (a *Adapter) WritePersonalMemoryCommandResultActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	return a.WritePersonalMemoryCommandResult(ctx, input)
}

func (a *Adapter) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return a.FinalizeExecutionCancellation(ctx, input)
}

func (a *Adapter) FinalizeExecutionFailureActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return a.FinalizeExecutionFailure(ctx, input)
}

func (a *Adapter) WriteWorkflowFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteWorkflowFinalizationActivityInput,
) (temporalruntime.WorkflowFinalizationActivityOutput, error) {
	return a.WriteWorkflowFinalization(ctx, input)
}

func New(options Options) *Adapter {
	logger := options.Logger
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	return &Adapter{
		admissionService:          options.AdmissionService,
		config:                    options.Config,
		executionInputLoader:      options.ExecutionInputLoader,
		executionInputErr:         options.ExecutionInputError,
		logger:                    logger,
		personalMemoryExecutor:    options.PersonalMemoryExecutor,
		personalMemoryErr:         options.PersonalMemoryError,
		personalMemoryStateStore:  options.PersonalMemoryStateStore,
		personalMemoryStateErr:    options.PersonalMemoryStateError,
		productFinalizationWriter: options.ProductFinalizationWriter,
		productCallbackClient:     options.ProductCallbackClient,
		agentRuntimeClient:        options.AgentRuntimeClient,
		runProjectionStore:        options.RunProjectionStore,
	}
}

func (a *Adapter) loadExecutionInput(
	ctx context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if a == nil || a.executionInputLoader == nil {
		cause := error(nil)
		if a != nil {
			cause = a.executionInputErr
		}
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	return a.executionInputLoader.Load(ctx, run)
}

func (a *Adapter) loadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	wire, err := a.loadExecutionInput(ctx, run)
	if err != nil {
		return nil, err
	}
	return execution.PayloadMap(wire), nil
}

func (a *Adapter) writeProductFinalization(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
	response map[string]any,
) error {
	if a == nil || a.productFinalizationWriter == nil {
		return errors.New("product finalization writer is not configured")
	}
	return a.productFinalizationWriter(ctx, run, completedAt, response)
}
