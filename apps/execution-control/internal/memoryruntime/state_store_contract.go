package memoryruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var (
	ErrMemoryFenceConflict           = errors.New("personal memory fence conflict")
	ErrMemoryReceiptBlocked          = errors.New("personal memory command is blocked by an earlier unresolved receipt")
	ErrMemoryCommandNotFound         = errors.New("personal memory command not found")
	ErrMemoryOwnerNotDrained         = errors.New("personal memory owner has not drained")
	ErrMemoryStateStoreNotConfigured = errors.New("personal memory state store not configured")
)

// CommandResultFingerprint derives the idempotency fingerprint of a terminal
// command outcome. Receipt abandon and the activity finalizer must produce the
// same value for the same (commandID, status, errorCode) triple.
func CommandResultFingerprint(commandID string, status string, errorCode string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(commandID) + "\x00" + strings.TrimSpace(status) + "\x00" + strings.TrimSpace(errorCode)))
	return hex.EncodeToString(sum[:])
}

// CommandReceiptStaleAfter bounds how long a non-terminal receipt may go
// untouched before owners treat it as abandoned. It exceeds every live
// workflow retry chain (lease TTL plus activity backoff), so only receipts
// whose workflow is gone go stale.
const CommandReceiptStaleAfter = 10 * time.Minute

// CommandReceiptStale reports whether a non-terminal receipt stopped being
// touched for longer than CommandReceiptStaleAfter. Terminal receipts are
// never stale.
func CommandReceiptStale(receipt CommandReceipt, now time.Time) bool {
	if CommandReceiptTerminal(receipt.Status) {
		return false
	}
	touchedAt := receipt.UpdatedAt
	if touchedAt.IsZero() {
		touchedAt = receipt.CreatedAt
	}
	return !touchedAt.IsZero() && now.Sub(touchedAt) > CommandReceiptStaleAfter
}

type CommandReceipt struct {
	CommandID         string
	CreatedAt         time.Time
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
	UpdatedAt         time.Time
}
