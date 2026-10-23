package memoryapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type CallLeaseStore interface {
	BeginCall(context.Context, string, string, int64, string, time.Duration) error
	EndCall(context.Context, string, string) error
}

type CommandReceiptStore interface {
	BeginCommand(context.Context, string, memoryruntime.PersonalMemoryCommandRequest, time.Duration) (memoryruntime.CommandReceipt, bool, error)
	FinalizeCommand(context.Context, string, string, string, string, string) (memoryruntime.CommandReceipt, error)
	GetCommand(context.Context, string, string) (memoryruntime.CommandReceipt, error)
	MarkCommandRetryable(context.Context, string, string) error
}

type OwnerLifecycleStore interface {
	GenerationDrained(context.Context, string, int64) (bool, error)
	ListGenerationAppendCallIDs(context.Context, string, int64) ([]string, error)
	MarkOwnerDeleted(context.Context, string) error
}

type MemoryStateStore interface {
	MemoryManagementStore
	CallLeaseStore
	CommandReceiptStore
	OwnerLifecycleStore
}

// MemoryManagementStore is the intentionally small management surface.
type MemoryManagementStore interface {
	GetCommand(context.Context, string, string) (memoryruntime.CommandReceipt, error)
	MarkOwnerDeleted(context.Context, string) error
}

type MemoryRecaller interface {
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
}

type MemoryCommandExecutor interface {
	ExecuteCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error)
}

type ProfileReader interface {
	GetProfile(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error)
}

type AsyncMemoryExecutor interface {
	SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error)
	GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error)
}
