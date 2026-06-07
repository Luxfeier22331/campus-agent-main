package execution

import (
	"context"
	"errors"
	"sync"
	"time"
)

var (
	ErrDurableRunExists                 = errors.New("durable run already exists")
	ErrDurableRuntimeStoreNotConfigured = errors.New("durable runtime store not configured")
	ErrRunProjectionStoreNotConfigured  = errors.New("run projection store not configured")
	ErrDurableRunNotFound               = errors.New("durable run not found")
	ErrNoQueuedDurableRun               = errors.New("no queued durable run")
	ErrInvalidDurableRun                = errors.New("invalid durable run")
	ErrInvalidRunTransition             = errors.New("invalid durable run transition")
	ErrConversationActiveRun            = errors.New("conversation active run")
	ErrInvalidRunEvent                  = errors.New("invalid durable run event")
	ErrInvalidRunStep                   = errors.New("invalid run step projection")
	ErrInvalidStepAttempt               = errors.New("invalid step attempt projection")
	ErrInvalidStepResult                = errors.New("invalid step result projection")
	ErrInvalidTimedOutRunRecovery       = errors.New("invalid timed out run recovery")
	ErrInvalidDurableRunCancel          = errors.New("invalid durable run cancel")
)

type RunProjectionStore interface {
	CreateRun(context.Context, DurableRun) (DurableRun, error)
	DeleteRun(context.Context, string) error
	GetRun(context.Context, string) (DurableRun, error)
	ReplaceRunMetadata(context.Context, string, map[string]any) error
	TransitionRun(context.Context, string, DurableRunStatus, DurableTerminalReason, time.Time) (
		DurableRun,
		error,
	)
	CancelRunProjection(context.Context, DurableRunCancelRequest) (DurableRun, error)
	AppendRunEvent(context.Context, DurableRunEvent) (DurableRunEvent, error)
	ListRunEvents(context.Context, string) ([]DurableRunEvent, error)
	ListRunEventsAfter(context.Context, string, int64) ([]DurableRunEvent, error)
	UpsertRunStep(context.Context, RunStepProjection) (RunStepProjection, error)
	UpsertStepAttempt(context.Context, StepAttemptProjection) (StepAttemptProjection, error)
	UpsertStepResult(context.Context, StepResultProjection) (StepResultProjection, error)
	ListRunSteps(context.Context, string) ([]RunStepProjection, error)
	ListStepAttempts(context.Context, string) ([]StepAttemptProjection, error)
	ListStepResults(context.Context, string) ([]StepResultProjection, error)
}

type DurableRuntimeStore interface {
	RunProjectionStore
	RecoverTimedOutRuns(context.Context, TimedOutRunRecoveryRequest) (
		[]TimedOutRunRecoveryResult,
		error,
	)
	CancelRun(context.Context, DurableRunCancelRequest) (DurableRunCancelResult, error)
}

type InMemoryDurableRuntimeStore struct {
	mu                      sync.RWMutex
	runs                    map[string]DurableRun
	runEvents               map[string][]DurableRunEvent
	runSteps                map[string]RunStepProjection
	stepAttempts            map[string]StepAttemptProjection
	stepResults             map[string]StepResultProjection
	activeRunByConversation map[string]string
}

func NewInMemoryDurableRuntimeStore() *InMemoryDurableRuntimeStore {
	return &InMemoryDurableRuntimeStore{
		runs:                    map[string]DurableRun{},
		runEvents:               map[string][]DurableRunEvent{},
		runSteps:                map[string]RunStepProjection{},
		stepAttempts:            map[string]StepAttemptProjection{},
		stepResults:             map[string]StepResultProjection{},
		activeRunByConversation: map[string]string{},
	}
}
