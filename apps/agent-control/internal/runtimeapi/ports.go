package runtimeapi

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/operation"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication/projection"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"time"
)

type RuntimeInputPort interface {
	PrepareRuntimeOperation(context.Context, operation.OperationRequest) (executionapplication.AgentRuntimeRequest, error)
	LoadToolContext(context.Context, string) (map[string]any, time.Time, error)
}
type RuntimeInvocationPort interface {
	Get(context.Context, executionapplication.RuntimeInvocationRequest) (executionapplication.RuntimeInvocationResult, error)
	Begin(context.Context, executionapplication.RuntimeInvocationRequest) (executionapplication.RuntimeInvocationResult, error)
	Complete(context.Context, executionapplication.RuntimeInvocationRequest) (executionapplication.RuntimeInvocationResult, error)
}
type RuntimeProjectionPort interface {
	TemporalActivityRun(context.Context, string) (execution.DurableRun, error)
	ListStepAttempts(context.Context, string) ([]execution.StepAttemptProjection, error)
	ListRunSteps(context.Context, string) ([]execution.RunStepProjection, error)
	ProjectBufferedSolveAnswer(context.Context, execution.DurableRun, operation.OperationRequest, *executioncontract.OperationOutput) error
	ProjectWorkflowToolResults(context.Context, execution.DurableRun, operation.OperationRequest, []executionapplication.AgentToolResult, activityprojection.StepProjection, ...time.Time) error
	ProjectOperationCompletion(context.Context, execution.DurableRun, operation.OperationRequest, executionapplication.AgentRuntimeResult, executioncontract.OperationOutput, activityprojection.StepProjection, time.Time) error
	ProjectWorkflowAnswerStarted(context.Context, execution.DurableRun, string) error
	ProjectWorkflowAnswerCompleted(context.Context, execution.DurableRun, string) error
	ProjectWorkflowAnswerDelta(context.Context, execution.DurableRun, string, int, string) error
	AppendRunEvent(context.Context, execution.DurableRunEvent) error
}
