package memoryruntime

import (
	"context"
	"errors"
	"testing"
	"time"
)

const (
	testCommandResultFingerprint  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	otherCommandResultFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func TestInMemoryStateStoreFencesOnlineCallsAcrossPauseAndErase(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	if err := store.BeginCall(ctx, "owner", "run-1:recall", 1, 0, "subject", "recall", time.Minute); err != nil {
		t.Fatalf("begin initial recall: %v", err)
	}
	if err := store.EndCall(ctx, "owner", "run-1:recall"); err != nil {
		t.Fatalf("end initial recall: %v", err)
	}
	pause := PersonalMemoryCommandRequest{CommandID: "cmd-pause", CommandKind: "owner_transition", LifecycleState: "paused", OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:lifecycle", TenantID: "tenant-main", UserID: "user-1"}
	if _, execute, err := store.BeginCommand(ctx, "owner", pause, time.Minute); err != nil || !execute {
		t.Fatalf("begin pause execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, pause.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, "paused"); err != nil {
		t.Fatalf("complete pause: %v", err)
	}
	if err := store.BeginCall(ctx, "owner", "run-2:recall", 1, 1, "subject", "recall", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("paused recall error=%v", err)
	}
	erase := PersonalMemoryCommandRequest{CommandID: "cmd-erase", CommandKind: "owner_erase", OwnerGeneration: 2, OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:erase:2", TenantID: "tenant-main", UserID: "user-1"}
	if _, execute, err := store.BeginCommand(ctx, "owner", erase, time.Minute); err != nil || !execute {
		t.Fatalf("begin erase execute=%t err=%v", execute, err)
	}
	if err := store.BeginCall(ctx, "owner", "run-stale:append", 1, 1, "subject", "append", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("stale append error=%v", err)
	}
}

func TestInMemoryStateStoreAllowsEraseToJumpSupersededSequences(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	pause := PersonalMemoryCommandRequest{CommandID: "pause", CommandKind: "owner_transition", LifecycleState: "paused", OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:lifecycle"}
	if _, execute, err := store.BeginCommand(ctx, "owner", pause, time.Minute); err != nil || !execute {
		t.Fatalf("begin pause: execute=%v err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, "pause", "owner", "succeeded", "", testCommandResultFingerprint, "paused"); err != nil {
		t.Fatal(err)
	}
	erase := PersonalMemoryCommandRequest{CommandID: "erase", CommandKind: "owner_erase", OwnerGeneration: 2, OwnerSequence: 4, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:erase:2"}
	if _, execute, err := store.BeginCommand(ctx, "owner", erase, time.Minute); err != nil || !execute {
		t.Fatalf("begin erase after superseded sequence gap: execute=%v err=%v", execute, err)
	}
}

func TestInMemoryStateStoreAllowsSameGenerationEraseAfterErased(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	first := PersonalMemoryCommandRequest{
		CommandID:         "erase-first",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     1,
		SchemaVersion:     PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "owner:erase:2",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", first, time.Minute); err != nil || !execute {
		t.Fatalf("begin first erase execute=%v err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, first.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, "erased"); err != nil {
		t.Fatalf("finalize first erase: %v", err)
	}

	duplicate := first
	duplicate.CommandID = "erase-duplicate"
	duplicate.OwnerSequence = 2
	if _, execute, err := store.BeginCommand(ctx, "owner", duplicate, time.Minute); err != nil || !execute {
		t.Fatalf("begin duplicate erase execute=%v err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, duplicate.CommandID, "owner", "succeeded", "", otherCommandResultFingerprint, "erased"); err != nil {
		t.Fatalf("finalize duplicate erase: %v", err)
	}
}

func TestInMemoryStateStoreAllowsCoalescedSequenceGapAndRejectsOlderCommand(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	coalesced := PersonalMemoryCommandRequest{
		CommandID: "coalesced-pause", CommandKind: "owner_transition", LifecycleState: "paused",
		OwnerGeneration: 1, OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt: "2026-07-16T00:00:02Z", SupersessionScope: "owner:lifecycle",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner-gap", coalesced, time.Minute); err != nil || !execute {
		t.Fatalf("begin coalesced sequence gap execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, coalesced.CommandID, "owner-gap", "succeeded", "", testCommandResultFingerprint, "paused"); err != nil {
		t.Fatal(err)
	}
	stale := PersonalMemoryCommandRequest{
		CommandID: "stale-item", CommandKind: "item_delete", OwnerGeneration: 1, OwnerSequence: 1,
		SchemaVersion: PersonalMemoryCommandSchemaVersion, SourceUpdatedAt: "2026-07-16T00:00:01Z",
		SubjectID: "memory-1", SupersessionScope: "item:memory-1",
	}
	if _, _, err := store.BeginCommand(ctx, "owner-gap", stale, time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("stale lower sequence error=%v, want ErrMemoryFenceConflict", err)
	}
}

func TestInMemoryStateStoreReplaysSucceededReceiptWithoutExecution(t *testing.T) {
	store := NewInMemoryStateStore()
	command := PersonalMemoryCommandRequest{CommandID: "cmd-1", CommandKind: "owner_transition", LifecycleState: "paused", OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:lifecycle", TenantID: "tenant-main", UserID: "user-1"}
	if _, execute, err := store.BeginCommand(context.Background(), "owner", command, time.Minute); err != nil || !execute {
		t.Fatalf("first begin execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(context.Background(), command.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, "paused"); err != nil {
		t.Fatal(err)
	}
	receipt, execute, err := store.BeginCommand(context.Background(), "owner", command, time.Minute)
	if err != nil || execute || receipt.Status != "succeeded" {
		t.Fatalf("replay receipt=%#v execute=%t err=%v", receipt, execute, err)
	}
}

func TestInMemoryStateStoreSubjectDrainWaitsForEarlierConversationCall(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	if err := store.BeginCall(ctx, "owner", "run-1:append", 1, 0, "conversation-a", "append", time.Minute); err != nil {
		t.Fatal(err)
	}
	drained, err := store.SubjectDrained(ctx, "owner", 1, "conversation-a", 1)
	if err != nil || drained {
		t.Fatalf("drained=%t err=%v, want active call to block deletion", drained, err)
	}
	if err := store.EndCall(ctx, "owner", "run-1:append"); err != nil {
		t.Fatal(err)
	}
	drained, err = store.SubjectDrained(ctx, "owner", 1, "conversation-a", 1)
	if err != nil || !drained {
		t.Fatalf("drained=%t err=%v, want subject drained", drained, err)
	}
}

func TestInMemoryStateStoreGenerationDrainIncludesProcessingReceipts(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-delete", CommandKind: "item_delete", OwnerGeneration: 1,
		OwnerSequence: 1, SubjectID: "mem-1", SubjectScopeHash: "item-1",
		SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "item:mem-1",
		TenantID: "tenant-main", UserID: "user-1",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", command, time.Minute); err != nil || !execute {
		t.Fatalf("execute=%t err=%v", execute, err)
	}
	drained, err := store.GenerationDrained(ctx, "owner", 1)
	if err != nil || drained {
		t.Fatalf("drained=%t err=%v, want processing receipt to block erase", drained, err)
	}
	if _, err := store.FinalizeCommand(ctx, command.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, ""); err != nil {
		t.Fatal(err)
	}
	drained, err = store.GenerationDrained(ctx, "owner", 1)
	if err != nil || !drained {
		t.Fatalf("drained=%t err=%v, want generation drained", drained, err)
	}
}

func TestInMemoryStateStoreBlocksLaterOwnerSequenceUntilEarlierReceiptIsTerminal(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	first := PersonalMemoryCommandRequest{
		CommandID: "cmd-1", CommandKind: "item_upsert", Item: &PersonalMemoryCommandItem{Key: "program", Value: "cs"},
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt: "2026-07-16T00:00:00Z", SubjectID: "memory-1", SupersessionScope: "item:memory-1",
	}
	second := PersonalMemoryCommandRequest{
		CommandID: "cmd-2", CommandKind: "owner_transition", LifecycleState: "paused",
		OwnerGeneration: 1, OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "owner:lifecycle",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", first, time.Minute); err != nil || !execute {
		t.Fatalf("begin first execute=%t err=%v", execute, err)
	}
	if _, _, err := store.BeginCommand(ctx, "owner", second, time.Minute); !errors.Is(err, ErrMemoryReceiptBlocked) {
		t.Fatalf("later command error=%v, want ErrMemoryReceiptBlocked", err)
	}
	if err := store.MarkCommandRetryable(ctx, first.CommandID, "owner"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.BeginCommand(ctx, "owner", second, time.Minute); !errors.Is(err, ErrMemoryReceiptBlocked) {
		t.Fatalf("retryable earlier receipt error=%v, want ErrMemoryReceiptBlocked", err)
	}
	if _, err := store.FinalizeCommand(ctx, first.CommandID, "owner", "failed", "personal_memory_command_failed", testCommandResultFingerprint, ""); err != nil {
		t.Fatal(err)
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", second, time.Minute); err != nil || !execute {
		t.Fatalf("begin second after terminal execute=%t err=%v", execute, err)
	}
}

func TestInMemoryStateStoreFinalizesReceiptWithIdempotentCAS(t *testing.T) {
	store := NewInMemoryStateStore()
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-finalize", CommandKind: "owner_transition", LifecycleState: "paused",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "owner:lifecycle",
	}
	if _, execute, err := store.BeginCommand(context.Background(), "owner", command, time.Minute); err != nil || !execute {
		t.Fatalf("begin execute=%t err=%v", execute, err)
	}
	first, err := store.FinalizeCommand(context.Background(), command.CommandID, "owner", "failed", "personal_memory_command_failed", testCommandResultFingerprint, "")
	if err != nil || first.Status != "failed" {
		t.Fatalf("first finalization receipt=%#v err=%v", first, err)
	}
	replay, err := store.FinalizeCommand(context.Background(), command.CommandID, "owner", "failed", "personal_memory_command_failed", testCommandResultFingerprint, "")
	if err != nil || replay.Status != "failed" {
		t.Fatalf("idempotent finalization receipt=%#v err=%v", replay, err)
	}
	if _, err := store.FinalizeCommand(context.Background(), command.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, "paused"); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("conflicting finalization error=%v, want ErrMemoryFenceConflict", err)
	}
	if _, err := store.FinalizeCommand(context.Background(), command.CommandID, "owner", "failed", "personal_memory_command_failed", otherCommandResultFingerprint, ""); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("conflicting fingerprint error=%v, want ErrMemoryFenceConflict", err)
	}
}

func TestInMemoryStateStoreDrainTreatsRetryableReceiptAsActive(t *testing.T) {
	store := NewInMemoryStateStore()
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-retryable", CommandKind: "item_delete", OwnerGeneration: 1, OwnerSequence: 1,
		SchemaVersion: PersonalMemoryCommandSchemaVersion, SubjectID: "memory-1", SubjectScopeHash: "subject-hash",
		SupersessionScope: "item:memory-1",
	}
	if _, execute, err := store.BeginCommand(context.Background(), "owner", command, time.Nanosecond); err != nil || !execute {
		t.Fatalf("begin execute=%t err=%v", execute, err)
	}
	if err := store.MarkCommandRetryable(context.Background(), command.CommandID, "owner"); err != nil {
		t.Fatal(err)
	}
	drained, err := store.GenerationDrained(context.Background(), "owner", 1)
	if err != nil || drained {
		t.Fatalf("generation drained=%t err=%v, want retryable receipt active", drained, err)
	}
}
