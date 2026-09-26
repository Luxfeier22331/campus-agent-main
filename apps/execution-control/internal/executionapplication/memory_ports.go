package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type MemoryStore interface {
	AbandonStaleGenerationReceipts(context.Context, string, int64, time.Time) (int, error)
	BeginCall(context.Context, string, string, int64, string, time.Duration) error
	BeginCommand(context.Context, string, memoryruntime.PersonalMemoryCommandRequest, time.Duration) (memoryruntime.CommandReceipt, bool, error)
	EndCall(context.Context, string, string) error
	FinalizeCommand(context.Context, string, string, string, string, string, string) (memoryruntime.CommandReceipt, error)
	GetCommand(context.Context, string, string) (memoryruntime.CommandReceipt, error)
	GenerationDrained(context.Context, string, int64) (bool, error)
	ListGenerationAppendCallIDs(context.Context, string, int64) ([]string, error)
	MarkOwnerDeleted(context.Context, string) error
	MarkCommandRetryable(context.Context, string, string) error
}

type MemoryExecutor interface {
	ExecuteCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error)
	AppendConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendConversationTurnResult, error)
	Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error)
}

type MemoryReader interface {
	GetProfile(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error)
}

type AsyncMemoryExecutor interface {
	SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error)
	GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error)
}
