package executionapplication

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"time"
)

type RunStore interface {
	RunLifecycleStore
	RunWorkflowDispatchStore
	RunEventStore
	RunProjectionStore
}

type RunLifecycleStore interface {
	OwnerDeletionStore
	CreateRun(context.Context, execution.DurableRun) (execution.DurableRun, error)
	CreateRunWithStartIntent(context.Context, execution.DurableRunCreateIntent) (execution.DurableRunCreateResult, error)
	DeleteRun(context.Context, string) error
	GetRun(context.Context, string) (execution.DurableRun, error)
	ReplaceRunMetadata(context.Context, string, map[string]any) error
	TransitionRun(context.Context, string, execution.DurableRunStatus, execution.DurableTerminalReason, time.Time) (execution.DurableRun, error)
	StartRunAnswerStream(context.Context, execution.RunAnswerStreamStartRequest) (execution.DurableRun, error)
	FailRunProjection(context.Context, execution.DurableRunFailRequest) (execution.DurableRun, error)
	ExpireRunProjection(context.Context, execution.DurableRunExpireRequest) (execution.DurableRun, error)
	CompleteRunProjection(context.Context, execution.DurableRunCompleteRequest) (execution.DurableRun, error)
	FinalizeRunProjection(context.Context, execution.RunProjectionFinalizeRequest) (execution.RunProjectionFinalizeResult, error)
	CancelRunProjection(context.Context, execution.DurableRunCancelRequest) (execution.DurableRun, error)
	RequestRunCancellation(context.Context, execution.DurableRunCancellationRequest) (execution.DurableRun, error)
	LeaseRunCancellationCommands(context.Context, execution.LifecycleLeaseRequest) ([]execution.RunCancellationCommand, error)
	ConfirmRunCancellationCommand(context.Context, execution.RunCancellationCommandResult) error
	RetryRunCancellationCommand(context.Context, execution.RunCancellationCommandResult) error
}

type RunWorkflowDispatchStore interface {
	GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error)
	LeaseWorkflowStartIntents(context.Context, execution.LifecycleLeaseRequest) ([]execution.WorkflowStartIntent, error)
	MarkWorkflowStartDispatchAttempt(context.Context, execution.WorkflowStartIntentResult) error
	BindSupersededWorkflowStartExecution(context.Context, execution.WorkflowStartExecutionBinding) (execution.WorkflowStartIntent, error)
	ConfirmWorkflowStartIntent(context.Context, execution.WorkflowStartIntentResult) error
	RetryWorkflowStartIntent(context.Context, execution.WorkflowStartIntentResult) error
	FailWorkflowStartIntent(context.Context, execution.WorkflowStartIntentResult) error
}

type RunEventStore interface {
	AppendRunEvent(context.Context, execution.DurableRunEvent) (execution.DurableRunEvent, error)
	ListRunEvents(context.Context, string) ([]execution.DurableRunEvent, error)
	ListRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error)
	WaitForRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error)
}

type RunProjectionStore interface {
	RecordModelOutputDiagnostic(context.Context, string, string, execution.ModelOutputDiagnostic) error
	UpsertRunStep(context.Context, execution.RunStepProjection) (execution.RunStepProjection, error)
	UpsertStepAttempt(context.Context, execution.StepAttemptProjection) (execution.StepAttemptProjection, error)
	UpsertStepResult(context.Context, execution.StepResultProjection) (execution.StepResultProjection, error)
	ListRunSteps(context.Context, string) ([]execution.RunStepProjection, error)
	ListStepAttempts(context.Context, string) ([]execution.StepAttemptProjection, error)
	ListStepResults(context.Context, string) ([]execution.StepResultProjection, error)
}

type OwnerDeletionStore interface {
	BeginOwnerDeletion(context.Context, string, time.Time) (execution.OwnerDeletionStatus, error)
	OwnerDeletionStatus(context.Context, string) (execution.OwnerDeletionStatus, error)
	FinalizeOwnerDeletion(context.Context, execution.OwnerDeletionFinalizeRequest) (execution.OwnerDeletionStatus, error)
}

type ReceiptStore interface {
	GetAgentInvocationReceipt(context.Context, string) (execution.AgentInvocationReceipt, error)
	BeginAgentInvocation(context.Context, execution.AgentInvocationReceipt) (execution.AgentInvocationReceipt, execution.AgentInvocationDisposition, error)
	CompleteAgentInvocation(context.Context, execution.AgentInvocationReceipt) (execution.AgentInvocationReceipt, error)
}
