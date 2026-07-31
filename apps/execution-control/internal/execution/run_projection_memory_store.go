package execution

import (
	"context"
	"errors"
	"sync"
	"time"
)

var (
	ErrDurableRunExists                      = errors.New("durable run already exists")
	ErrRunProjectionStoreNotConfigured       = errors.New("run projection store not configured")
	ErrDurableRunNotFound                    = errors.New("durable run not found")
	ErrInvalidDurableRun                     = errors.New("invalid durable run")
	ErrInvalidDurableRunComplete             = errors.New("invalid durable run complete")
	ErrInvalidRunTransition                  = errors.New("invalid durable run transition")
	ErrConversationActiveRun                 = errors.New("conversation active run")
	ErrInvalidRunEvent                       = errors.New("invalid durable run event")
	ErrInvalidRunStep                        = errors.New("invalid run step projection")
	ErrStaleRunStepProjection                = errors.New("stale run step projection")
	ErrInvalidStepAttempt                    = errors.New("invalid step attempt projection")
	ErrStaleStepAttemptProjection            = errors.New("stale step attempt projection")
	ErrInvalidStepResult                     = errors.New("invalid step result projection")
	ErrStepResultProjectionConflict          = errors.New("step result projection conflict")
	ErrRunFinalizationConflict               = errors.New("run finalization conflict")
	ErrInvalidDurableRunCancel               = errors.New("invalid durable run cancel")
	ErrDurableRunFailureConflict             = errors.New("durable run failure projection conflict")
	ErrDurableRunExpiryConflict              = errors.New("durable run expiry projection conflict")
	ErrDurableRunFingerprintConflict         = errors.New("durable run request fingerprint conflict")
	ErrDurableRunTerminalConflict            = errors.New("durable run terminal conflict")
	ErrLifecycleLeaseConflict                = errors.New("lifecycle lease conflict")
	ErrWorkflowStartExecutionBindingConflict = errors.New("workflow start execution binding conflict")
	ErrAgentInvocationConflict               = errors.New("agent invocation receipt conflict")
	ErrAgentInvocationNotFound               = errors.New("agent invocation receipt not found")
)

type RunProjectionStore interface {
	CreateRun(context.Context, DurableRun) (DurableRun, error)
	CreateRunWithStartIntent(context.Context, DurableRunCreateIntent) (DurableRunCreateResult, error)
	DeleteRun(context.Context, string) error
	GetRun(context.Context, string) (DurableRun, error)
	ReplaceRunMetadata(context.Context, string, map[string]any) error
	TransitionRun(context.Context, string, DurableRunStatus, DurableTerminalReason, time.Time) (
		DurableRun,
		error,
	)
	StartRunAnswerStream(context.Context, RunAnswerStreamStartRequest) (DurableRun, error)
	FailRunProjection(context.Context, DurableRunFailRequest) (DurableRun, error)
	ExpireRunProjection(context.Context, DurableRunExpireRequest) (DurableRun, error)
	CompleteRunProjection(context.Context, DurableRunCompleteRequest) (DurableRun, error)
	FinalizeRunProjection(context.Context, RunProjectionFinalizeRequest) (RunProjectionFinalizeResult, error)
	CancelRunProjection(context.Context, DurableRunCancelRequest) (DurableRun, error)
	RequestRunCancellation(context.Context, DurableRunCancellationRequest) (DurableRun, error)
	GetWorkflowStartIntent(context.Context, string) (WorkflowStartIntent, error)
	LeaseWorkflowStartIntents(context.Context, LifecycleLeaseRequest) ([]WorkflowStartIntent, error)
	MarkWorkflowStartDispatchAttempt(context.Context, WorkflowStartIntentResult) error
	BindSupersededWorkflowStartExecution(context.Context, WorkflowStartExecutionBinding) (WorkflowStartIntent, error)
	ConfirmWorkflowStartIntent(context.Context, WorkflowStartIntentResult) error
	RetryWorkflowStartIntent(context.Context, WorkflowStartIntentResult) error
	FailWorkflowStartIntent(context.Context, WorkflowStartIntentResult) error
	LeaseRunCancellationCommands(context.Context, LifecycleLeaseRequest) ([]RunCancellationCommand, error)
	ConfirmRunCancellationCommand(context.Context, RunCancellationCommandResult) error
	RetryRunCancellationCommand(context.Context, RunCancellationCommandResult) error
	GetAgentInvocationReceipt(context.Context, string) (AgentInvocationReceipt, error)
	BeginAgentInvocation(context.Context, AgentInvocationReceipt) (AgentInvocationReceipt, AgentInvocationDisposition, error)
	CompleteAgentInvocation(context.Context, AgentInvocationReceipt) (AgentInvocationReceipt, error)
	AppendRunEvent(context.Context, DurableRunEvent) (DurableRunEvent, error)
	ListRunEvents(context.Context, string) ([]DurableRunEvent, error)
	ListRunEventsAfter(context.Context, string, int64) ([]DurableRunEvent, error)
	WaitForRunEventsAfter(context.Context, string, int64) ([]DurableRunEvent, error)
	UpsertRunStep(context.Context, RunStepProjection) (RunStepProjection, error)
	UpsertStepAttempt(context.Context, StepAttemptProjection) (StepAttemptProjection, error)
	UpsertStepResult(context.Context, StepResultProjection) (StepResultProjection, error)
	ListRunSteps(context.Context, string) ([]RunStepProjection, error)
	ListStepAttempts(context.Context, string) ([]StepAttemptProjection, error)
	ListStepResults(context.Context, string) ([]StepResultProjection, error)
}

type InMemoryRunProjectionStore struct {
	mu                      sync.RWMutex
	runs                    map[string]DurableRun
	runEvents               map[string][]DurableRunEvent
	runSteps                map[string]RunStepProjection
	stepAttempts            map[string]StepAttemptProjection
	stepResults             map[string]StepResultProjection
	activeRunByConversation map[string]string
	workflowStartIntents    map[string]WorkflowStartIntent
	cancellationCommands    map[string]RunCancellationCommand
	agentInvocationReceipts map[string]AgentInvocationReceipt
	runEventWaiters         map[string]map[chan struct{}]struct{}
}

func NewInMemoryRunProjectionStore() *InMemoryRunProjectionStore {
	return &InMemoryRunProjectionStore{
		runs:                    map[string]DurableRun{},
		runEvents:               map[string][]DurableRunEvent{},
		runSteps:                map[string]RunStepProjection{},
		stepAttempts:            map[string]StepAttemptProjection{},
		stepResults:             map[string]StepResultProjection{},
		activeRunByConversation: map[string]string{},
		workflowStartIntents:    map[string]WorkflowStartIntent{},
		cancellationCommands:    map[string]RunCancellationCommand{},
		agentInvocationReceipts: map[string]AgentInvocationReceipt{},
		runEventWaiters:         map[string]map[chan struct{}]struct{}{},
	}
}
