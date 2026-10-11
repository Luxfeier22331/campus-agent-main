package memoryapplication

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type AppendWorkflowReviver interface {
	RestartMemoryAppendWorkflow(context.Context, string) error
	RunningMemoryAppendWorkflows(context.Context, []string) (map[string]bool, error)
}

type Service struct {
	OwnerSalt              string
	TimeoutSeconds         float64
	CommandExecutor        MemoryCommandExecutor
	Recaller               MemoryRecaller
	AsyncMemoryExecutor    AsyncMemoryExecutor
	PersonalMemoryErr      error
	CommandStateStore      CommandReceiptStore
	CallLeaseStore         CallLeaseStore
	OwnerLifecycleStore    OwnerLifecycleStore
	PersonalMemoryStateErr error
	AppendWorkflowReviver  AppendWorkflowReviver
}

type FinalizeCommandInput struct {
	Command memoryruntime.PersonalMemoryCommandRequest
	Result  memoryruntime.PersonalMemoryCommandResult
}

type Error struct {
	Code         string
	Cause        error
	NonRetryable bool
}

func (e *Error) Error() string { return e.Code }
func (e *Error) Unwrap() error { return e.Cause }
func applicationError(code string, cause error, nonRetryable bool) error {
	return &Error{Code: code, Cause: cause, NonRetryable: nonRetryable}
}
