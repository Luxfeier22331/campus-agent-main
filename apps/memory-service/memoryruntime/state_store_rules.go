package memoryruntime

import (
	"fmt"
	"strings"
	"time"
)

// FenceState is the runtime-owned owner lifecycle fence projected by a state store.
// Persistence adapters use it when applying the same command ordering rules.
type FenceState struct {
	Generation int64
	Lifecycle  string
	Sequence   int64
}

func ApplyFenceCommand(fence *FenceState, command PersonalMemoryCommandRequest) error {
	if fence.Lifecycle == "deleted" {
		return fmt.Errorf("%w: owner is deleted", ErrMemoryFenceConflict)
	}
	switch command.CommandKind {
	case "owner_erase":
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: erase sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation+1 &&
			((fence.Lifecycle != "erasing" && fence.Lifecycle != "erased") || command.OwnerGeneration != fence.Generation) {
			return fmt.Errorf("%w: erase generation mismatch", ErrMemoryFenceConflict)
		}
		fence.Generation = command.OwnerGeneration
		fence.Lifecycle = "erasing"
	case "owner_transition":
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation || fence.Lifecycle == "erasing" {
			return fmt.Errorf("%w: owner transition rejected", ErrMemoryFenceConflict)
		}
		fence.Lifecycle = command.LifecycleState
	default:
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation || (fence.Lifecycle != "active" && fence.Lifecycle != "paused") {
			return fmt.Errorf("%w: memory mutation rejected", ErrMemoryFenceConflict)
		}
	}
	fence.Sequence = command.OwnerSequence
	return nil
}

func CommandReceiptTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case "succeeded", "failed":
		return true
	default:
		return false
	}
}

func ValidateCommandTerminalResult(status string, errorCode string) (string, string, error) {
	status = strings.TrimSpace(status)
	errorCode = strings.TrimSpace(errorCode)
	switch status {
	case "succeeded":
		return status, "", nil
	case "failed":
		if errorCode == "" {
			errorCode = "personal_memory_command_failed"
		}
		return status, errorCode, nil
	default:
		return "", "", fmt.Errorf("%w: command terminal status is invalid", ErrMemoryFenceConflict)
	}
}

func ValidateReceiptIdentity(receipt CommandReceipt, ownerHash string, command PersonalMemoryCommandRequest) error {
	if receipt.OwnerScopeHash != ownerHash || receipt.Generation != command.OwnerGeneration || receipt.Sequence != command.OwnerSequence || receipt.Kind != command.CommandKind || receipt.SubjectScopeHash != command.SubjectScopeHash || receipt.SupersessionScope != command.SupersessionScope {
		return fmt.Errorf("%w: command receipt identity mismatch", ErrMemoryFenceConflict)
	}
	return nil
}

func CommandLeaseDeadline(ttl time.Duration) *time.Time {
	if ttl <= 0 {
		ttl = 105 * time.Second
	}
	deadline := time.Now().Add(ttl)
	return &deadline
}
