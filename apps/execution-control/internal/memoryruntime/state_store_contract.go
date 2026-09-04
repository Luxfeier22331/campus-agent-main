package memoryruntime

import (
	"context"
	"errors"
	"time"
)

var (
	ErrMemoryFenceConflict           = errors.New("personal memory fence conflict")
	ErrMemoryReceiptBlocked          = errors.New("personal memory command is blocked by an earlier unresolved receipt")
	ErrMemoryOwnerNotDrained         = errors.New("personal memory owner has not drained")
	ErrMemoryStateStoreNotConfigured = errors.New("personal memory state store not configured")
)

type CommandReceipt struct {
	CommandID         string
	ErrorCode         string
	Generation        int64
	Kind              string
	OwnerScopeHash    string
	ProcessingUntil   *time.Time
	ResultFingerprint string
	Sequence          int64
	Status            string
	SubjectScopeHash  string
	SupersessionScope string
}

type StateStore interface {
	BeginCall(context.Context, string, string, int64, int64, string, string, time.Duration) error
	BeginCommand(context.Context, string, PersonalMemoryCommandRequest, time.Duration) (CommandReceipt, bool, error)
	EndCall(context.Context, string, string) error
	FinalizeCommand(context.Context, string, string, string, string, string, string) (CommandReceipt, error)
	GenerationDrained(context.Context, string, int64) (bool, error)
	MarkOwnerDeleted(context.Context, string) error
	MarkCommandRetryable(context.Context, string, string) error
	SubjectDrained(context.Context, string, int64, string, int64) (bool, error)
}

type Executor interface {
	ExecuteCommand(context.Context, PersonalMemoryCommandRequest) (PersonalMemoryCommandResult, error)
	AppendConversationTurn(context.Context, AppendConversationTurnRequest) (AppendConversationTurnResult, error)
	Recall(context.Context, RecallRequest) (RecallResult, error)
}
