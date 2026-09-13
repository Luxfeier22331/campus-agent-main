//go:build postgres_integration

package postgres_test

import (
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func testPersonalMemoryStateStore(t *testing.T, harness *postgresHarness) {
	const (
		resultFingerprint      = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		conflictingFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	)
	_, databaseURL := harness.ownerDatabase(t)
	requireSchema(t, databaseURL)
	store, err := memorypersistence.NewPostgresStateStore(t.Context(), memorypersistence.PostgresStateStoreOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		t.Fatalf("create personal memory state store: %v", err)
	}
	t.Cleanup(store.Close)
	first := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-memory-first",
		CommandKind:       "memory_add",
		Item:              &memoryruntime.PersonalMemoryCommandItem{Text: "我的专业是计算机科学"},
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SubjectID:         "memory-1",
		SubjectScopeHash:  "subject-hash-1",
		SupersessionScope: "memory:memory-1",
	}
	second := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-memory-second",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "owner:lifecycle",
	}
	if _, execute, err := store.BeginCommand(t.Context(), "owner-hash", first, time.Minute); err != nil || !execute {
		t.Fatalf("begin first command execute=%t err=%v", execute, err)
	}
	if _, _, err := store.BeginCommand(t.Context(), "owner-hash", second, time.Minute); !errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
		t.Fatalf("later command gate error=%v", err)
	}
	if err := store.MarkCommandRetryable(t.Context(), first.CommandID, "owner-hash"); err != nil {
		t.Fatalf("mark first retryable: %v", err)
	}
	if drained, err := store.GenerationDrained(t.Context(), "owner-hash", 1); err != nil || drained {
		t.Fatalf("retryable receipt drained=%t err=%v", drained, err)
	}
	if _, err := store.FinalizeCommand(t.Context(), first.CommandID, "owner-hash", "failed", "personal_memory_command_failed", resultFingerprint, ""); err != nil {
		t.Fatalf("finalize first: %v", err)
	}
	if _, err := store.FinalizeCommand(t.Context(), first.CommandID, "owner-hash", "failed", "personal_memory_command_failed", resultFingerprint, ""); err != nil {
		t.Fatalf("replay first finalizer: %v", err)
	}
	if _, execute, err := store.BeginCommand(t.Context(), "owner-hash", second, time.Minute); err != nil || !execute {
		t.Fatalf("begin second command execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(t.Context(), second.CommandID, "owner-hash", "succeeded", "", resultFingerprint, "paused"); err != nil {
		t.Fatalf("finalize second: %v", err)
	}
	if _, err := store.FinalizeCommand(t.Context(), second.CommandID, "owner-hash", "failed", "personal_memory_command_failed", resultFingerprint, ""); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("conflicting terminal CAS error=%v", err)
	}
	if _, err := store.FinalizeCommand(t.Context(), first.CommandID, "owner-hash", "failed", "personal_memory_command_failed", conflictingFingerprint, ""); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("conflicting terminal fingerprint error=%v", err)
	}
	coalesced := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "cmd-coalesced", CommandKind: "owner_transition", LifecycleState: "paused",
		OwnerGeneration: 1, OwnerSequence: 2, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt: "2026-07-16T00:00:02Z", SupersessionScope: "owner:lifecycle",
	}
	if _, execute, err := store.BeginCommand(t.Context(), "owner-gap", coalesced, time.Minute); err != nil || !execute {
		t.Fatalf("begin coalesced gap execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(t.Context(), coalesced.CommandID, "owner-gap", "succeeded", "", resultFingerprint, "paused"); err != nil {
		t.Fatalf("finalize coalesced gap: %v", err)
	}
	stale := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "cmd-stale", CommandKind: "memory_update", OwnerGeneration: 1, OwnerSequence: 1,
		SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion, SourceUpdatedAt: "2026-07-16T00:00:01Z",
		SubjectID: "memory-stale", SupersessionScope: "memory:memory-stale",
	}
	if _, _, err := store.BeginCommand(t.Context(), "owner-gap", stale, time.Minute); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("stale lower sequence error=%v", err)
	}
	if err := store.BeginCall(t.Context(), "owner-deleted", "run-1:recall", 1, "recall", time.Minute); err != nil {
		t.Fatalf("begin active owner deletion call: %v", err)
	}
	if err := store.MarkOwnerDeleted(t.Context(), "owner-deleted"); !errors.Is(err, memoryruntime.ErrMemoryOwnerNotDrained) {
		t.Fatalf("mark owner deleted with active call error=%v", err)
	}
	if err := store.EndCall(t.Context(), "owner-deleted", "run-1:recall"); err != nil {
		t.Fatalf("end active owner deletion call: %v", err)
	}
	if err := store.MarkOwnerDeleted(t.Context(), "owner-deleted"); err != nil {
		t.Fatalf("mark drained owner deleted: %v", err)
	}
	if err := store.MarkOwnerDeleted(t.Context(), "owner-deleted"); err != nil {
		t.Fatalf("replay mark owner deleted: %v", err)
	}
	if err := store.BeginCall(t.Context(), "owner-deleted", "run-2:recall", 1, "recall", time.Minute); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("begin call after owner deletion error=%v", err)
	}
	afterDeletion := memoryruntime.PersonalMemoryCommandRequest{
		CommandID: "cmd-after-owner-deletion", CommandKind: "memory_update",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID: "memory-after-deletion", SubjectScopeHash: "subject-after-deletion",
		SupersessionScope: "memory:memory-after-deletion",
	}
	if _, _, err := store.BeginCommand(t.Context(), "owner-deleted", afterDeletion, time.Minute); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("begin command after owner deletion error=%v", err)
	}
}
