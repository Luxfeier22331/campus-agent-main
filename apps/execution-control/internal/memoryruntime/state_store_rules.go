package memoryruntime

import (
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

func applyFenceCommand(fence *memoryFence, command PersonalMemoryCommandRequest) error {
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

func commandReceiptTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case "succeeded", "failed":
		return true
	default:
		return false
	}
}

func validateCommandTerminalResult(status string, errorCode string, resultFingerprint string) (string, string, string, error) {
	status = strings.TrimSpace(status)
	errorCode = strings.TrimSpace(errorCode)
	resultFingerprint = strings.TrimSpace(resultFingerprint)
	if len(resultFingerprint) != 64 || resultFingerprint != strings.ToLower(resultFingerprint) {
		return "", "", "", fmt.Errorf("%w: command result fingerprint is invalid", ErrMemoryFenceConflict)
	}
	if _, err := hex.DecodeString(resultFingerprint); err != nil {
		return "", "", "", fmt.Errorf("%w: command result fingerprint is invalid", ErrMemoryFenceConflict)
	}
	switch status {
	case "succeeded":
		return status, "", resultFingerprint, nil
	case "failed":
		if errorCode == "" {
			errorCode = "personal_memory_command_failed"
		}
		return status, errorCode, resultFingerprint, nil
	default:
		return "", "", "", fmt.Errorf("%w: command terminal status is invalid", ErrMemoryFenceConflict)
	}
}

func validateReceiptIdentity(receipt CommandReceipt, ownerHash string, command PersonalMemoryCommandRequest) error {
	if receipt.OwnerScopeHash != ownerHash || receipt.Generation != command.OwnerGeneration || receipt.Sequence != command.OwnerSequence || receipt.Kind != command.CommandKind || receipt.SubjectScopeHash != command.SubjectScopeHash || receipt.SupersessionScope != command.SupersessionScope {
		return fmt.Errorf("%w: command receipt identity mismatch", ErrMemoryFenceConflict)
	}
	return nil
}

func commandLeaseDeadline(ttl time.Duration) *time.Time {
	if ttl <= 0 {
		ttl = 105 * time.Second
	}
	deadline := time.Now().Add(ttl)
	return &deadline
}
