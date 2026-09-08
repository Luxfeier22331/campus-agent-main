package execution

import (
	"errors"
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
