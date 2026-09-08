package memoryruntime

import (
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
