package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type MemoryStore interface {
	BeginCall(context.Context, string, string, int64, string, time.Duration) error
	BeginCommand(context.Context, string, memoryruntime.PersonalMemoryCommandRequest, time.Duration) (memoryruntime.CommandReceipt, bool, error)
	EndCall(context.Context, string, string) error
	FinalizeCommand(context.Context, string, string, string, string, string, string) (memoryruntime.CommandReceipt, error)
	GenerationDrained(context.Context, string, int64) (bool, error)
	MarkOwnerDeleted(context.Context, string) error
	MarkCommandRetryable(context.Context, string, string) error
}

type MemoryExecutor interface {
	ExecuteCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error)
	AppendConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendConversationTurnResult, error)
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
}

type MemoryReader interface {
	ListMemories(context.Context, memoryruntime.MemoryQuery) (memoryruntime.MemoryPage, error)
	GetMemory(context.Context, memoryruntime.MemoryQuery) (memoryruntime.MemoryRecord, error)
}
