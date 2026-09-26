package memorypersistence

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

const (
	testCommandResultFingerprint  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	otherCommandResultFingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

type PersonalMemoryCommandRequest = memoryruntime.PersonalMemoryCommandRequest
type PersonalMemoryCommandItem = memoryruntime.PersonalMemoryCommandItem

const PersonalMemoryCommandSchemaVersion = memoryruntime.PersonalMemoryCommandSchemaVersion

var (
	ErrMemoryFenceConflict   = memoryruntime.ErrMemoryFenceConflict
	ErrMemoryOwnerNotDrained = memoryruntime.ErrMemoryOwnerNotDrained
	ErrMemoryReceiptBlocked  = memoryruntime.ErrMemoryReceiptBlocked
)

func TestInMemoryStateStoreFencesOnlineCallsAcrossPauseAndErase(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	if err := store.BeginCall(ctx, "owner", "run-1:recall", 1, "recall", time.Minute); err != nil {
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
	if err := store.BeginCall(ctx, "owner", "run-2:recall", 1, "recall", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("paused recall error=%v", err)
	}
	if err := store.BeginCall(ctx, "owner", "management:list", 1, "management_list", time.Minute); err != nil {
		t.Fatalf("paused management read: %v", err)
	}
	if err := store.EndCall(ctx, "owner", "management:list"); err != nil {
		t.Fatalf("end paused management read: %v", err)
	}
	erase := PersonalMemoryCommandRequest{CommandID: "cmd-erase", CommandKind: "owner_erase", OwnerGeneration: 2, OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:erase:2", TenantID: "tenant-main", UserID: "user-1"}
	if _, execute, err := store.BeginCommand(ctx, "owner", erase, time.Minute); err != nil || !execute {
		t.Fatalf("begin erase execute=%t err=%v", execute, err)
	}
	if err := store.BeginCall(ctx, "owner", "run-stale:append", 1, "append", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
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
		CommandID: "stale-item", CommandKind: "memory_add", OwnerGeneration: 1, OwnerSequence: 1,
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

func TestOrdinaryMemoryCommandDoesNotFenceChatCalls(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	if err := store.BeginCall(ctx, "owner", "before", 1, "append", time.Minute); err != nil {
		t.Fatal(err)
	}
	cmd := PersonalMemoryCommandRequest{CommandID: "edit", CommandKind: "memory_add", OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "memory:fact"}
	if _, _, err := store.BeginCommand(ctx, "owner", cmd, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := store.BeginCall(ctx, "owner", "after", 1, "recall", time.Minute); err != nil {
		t.Fatalf("ordinary edit fenced chat: %v", err)
	}
	drained, err := store.GenerationDrained(ctx, "owner", 1)
	if err != nil || drained {
		t.Fatalf("erase must still wait for active calls: drained=%t err=%v", drained, err)
	}
}

func TestOwnerEraseAdvancesFenceDespiteEarlierUnresolvedCommand(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	command := PersonalMemoryCommandRequest{
		CommandID: "pending-edit", CommandKind: "memory_add", OwnerGeneration: 1,
		OwnerSequence: 1, SubjectID: "memory-1", SubjectScopeHash: "subject-hash",
		SchemaVersion: PersonalMemoryCommandSchemaVersion, SupersessionScope: "item:memory-1",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner-erase", command, time.Minute); err != nil || !execute {
		t.Fatalf("begin edit execute=%t err=%v", execute, err)
	}
	erase := PersonalMemoryCommandRequest{
		CommandID: "erase-now", CommandKind: "owner_erase", OwnerGeneration: 2,
		OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "owner:erase:2",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner-erase", erase, time.Minute); err != nil || !execute {
		t.Fatalf("begin erase execute=%t err=%v", execute, err)
	}
	if err := store.BeginCall(ctx, "owner-erase", "stale", 1, "recall", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("stale call error=%v, want fence conflict", err)
	}
}

func TestInMemoryStateStoreGenerationDrainIncludesProcessingReceipts(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-delete", CommandKind: "memory_add", OwnerGeneration: 1,
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

func TestInMemoryStateStoreMarkOwnerDeletedRequiresDrainAndFencesFutureWork(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	if err := store.BeginCall(ctx, "owner-deleted", "run-1:recall", 1, "recall", time.Minute); err != nil {
		t.Fatalf("begin active call: %v", err)
	}
	if err := store.MarkOwnerDeleted(ctx, "owner-deleted"); !errors.Is(err, ErrMemoryOwnerNotDrained) {
		t.Fatalf("mark owner deleted with active call error=%v, want ErrMemoryOwnerNotDrained", err)
	}
	if err := store.EndCall(ctx, "owner-deleted", "run-1:recall"); err != nil {
		t.Fatalf("end active call: %v", err)
	}
	if err := store.MarkOwnerDeleted(ctx, "owner-deleted"); err != nil {
		t.Fatalf("mark drained owner deleted: %v", err)
	}
	if err := store.MarkOwnerDeleted(ctx, "owner-deleted"); err != nil {
		t.Fatalf("replay mark owner deleted: %v", err)
	}
	if err := store.BeginCall(ctx, "owner-deleted", "run-2:recall", 1, "recall", time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("begin call after owner deletion error=%v, want ErrMemoryFenceConflict", err)
	}
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-after-owner-deletion", CommandKind: "memory_add",
		OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SubjectID: "memory-1", SubjectScopeHash: "subject-hash",
		SupersessionScope: "item:memory-1",
	}
	if _, _, err := store.BeginCommand(ctx, "owner-deleted", command, time.Minute); !errors.Is(err, ErrMemoryFenceConflict) {
		t.Fatalf("begin command after owner deletion error=%v, want ErrMemoryFenceConflict", err)
	}
}

func TestInMemoryStateStoreBlocksLaterOwnerSequenceUntilEarlierReceiptIsTerminal(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	first := PersonalMemoryCommandRequest{
		CommandID: "cmd-1", CommandKind: "memory_add", Item: &PersonalMemoryCommandItem{Text: "program: cs"},
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
		CommandID: "cmd-retryable", CommandKind: "memory_add", OwnerGeneration: 1, OwnerSequence: 1,
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

func TestInMemoryStateStoreFinalizeCommandMissingReceiptReturnsNotFound(t *testing.T) {
	store := NewInMemoryStateStore()
	if _, err := store.FinalizeCommand(context.Background(), "cmd-unknown", "owner", "failed", "personal_memory_command_failed", testCommandResultFingerprint, ""); !errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
		t.Fatalf("missing receipt error=%v, want ErrMemoryCommandNotFound", err)
	}
}

func TestInMemoryStateStoreAbandonStaleGenerationReceipts(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	// The owner gate permits at most one non-terminal receipt, so seed an old
	// terminal receipt first and leave the successor receipt unresolved.
	older := PersonalMemoryCommandRequest{
		CommandID: "cmd-older-gen", CommandKind: "memory_add", OwnerGeneration: 1,
		OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "item:mem-older-gen", SubjectID: "mem-older-gen",
	}
	stale := PersonalMemoryCommandRequest{
		CommandID: "cmd-stale-gen", CommandKind: "memory_add", OwnerGeneration: 1,
		OwnerSequence: 2, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "item:mem-stale-gen", SubjectID: "mem-stale-gen",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", older, time.Minute); err != nil || !execute {
		t.Fatalf("begin older execute=%t err=%v", execute, err)
	}
	if _, err := store.FinalizeCommand(ctx, older.CommandID, "owner", "succeeded", "", testCommandResultFingerprint, ""); err != nil {
		t.Fatal(err)
	}
	if _, execute, err := store.BeginCommand(ctx, "owner", stale, time.Minute); err != nil || !execute {
		t.Fatalf("begin stale execute=%t err=%v", execute, err)
	}
	fresh := PersonalMemoryCommandRequest{
		CommandID: "cmd-fresh-gen", CommandKind: "memory_add", OwnerGeneration: 1,
		OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "item:mem-fresh-gen", SubjectID: "mem-fresh-gen",
	}
	if _, execute, err := store.BeginCommand(ctx, "owner-fresh", fresh, time.Minute); err != nil || !execute {
		t.Fatalf("begin fresh execute=%t err=%v", execute, err)
	}
	store.ShiftReceiptClockForTest(stale.CommandID, -memoryruntime.CommandReceiptStaleAfter-time.Minute)
	// Staleness must ignore terminal state even when the receipt is old.
	store.ShiftReceiptClockForTest(older.CommandID, -memoryruntime.CommandReceiptStaleAfter-time.Minute)

	abandoned, err := store.AbandonStaleGenerationReceipts(ctx, "owner", 1, time.Now().Add(-memoryruntime.CommandReceiptStaleAfter))
	if err != nil || abandoned != 1 {
		t.Fatalf("abandoned=%d err=%v, want one stale receipt abandoned", abandoned, err)
	}
	staleReceipt, err := store.GetCommand(ctx, "owner", stale.CommandID)
	if err != nil || staleReceipt.Status != "failed" || staleReceipt.ErrorCode != "memory_receipt_abandoned" {
		t.Fatalf("abandoned receipt=%#v err=%v, want failed memory_receipt_abandoned", staleReceipt, err)
	}
	if staleReceipt.ResultFingerprint != memoryruntime.CommandResultFingerprint(stale.CommandID, "failed", "memory_receipt_abandoned") {
		t.Fatalf("abandoned fingerprint=%s, want canonical fingerprint", staleReceipt.ResultFingerprint)
	}
	olderReceipt, err := store.GetCommand(ctx, "owner", older.CommandID)
	if err != nil || olderReceipt.Status != "succeeded" {
		t.Fatalf("older terminal receipt=%#v err=%v, want untouched succeeded", olderReceipt, err)
	}
	if abandoned, err := store.AbandonStaleGenerationReceipts(ctx, "owner-fresh", 1, time.Now().Add(-memoryruntime.CommandReceiptStaleAfter)); err != nil || abandoned != 0 {
		t.Fatalf("fresh owner abandoned=%d err=%v, want zero", abandoned, err)
	}
	freshReceipt, err := store.GetCommand(ctx, "owner-fresh", fresh.CommandID)
	if err != nil || freshReceipt.Status != "processing" {
		t.Fatalf("fresh receipt=%#v err=%v, want untouched processing", freshReceipt, err)
	}
	if abandoned, err := store.AbandonStaleGenerationReceipts(ctx, "owner", 2, time.Now().Add(-memoryruntime.CommandReceiptStaleAfter)); err != nil || abandoned != 0 {
		t.Fatalf("other generation abandoned=%d err=%v, want zero", abandoned, err)
	}
	drained, err := store.GenerationDrained(ctx, "owner", 1)
	if err != nil || !drained {
		t.Fatalf("drained=%t err=%v, want abandoned generation drained", drained, err)
	}
}

func TestInMemoryStateStoreCommandReceiptUpdatedAtTracksTouchTime(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	command := PersonalMemoryCommandRequest{
		CommandID: "cmd-touch", CommandKind: "memory_add", OwnerGeneration: 1,
		OwnerSequence: 1, SchemaVersion: PersonalMemoryCommandSchemaVersion,
		SupersessionScope: "item:mem-touch", SubjectID: "mem-touch",
	}
	created, _, err := store.BeginCommand(ctx, "owner", command, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if created.UpdatedAt.IsZero() {
		t.Fatal("created receipt must record UpdatedAt")
	}
	if memoryruntime.CommandReceiptStale(created, time.Now()) {
		t.Fatal("fresh receipt must not be stale")
	}
	store.ShiftReceiptClockForTest(command.CommandID, -memoryruntime.CommandReceiptStaleAfter)
	aged, err := store.GetCommand(ctx, "owner", command.CommandID)
	if err != nil {
		t.Fatal(err)
	}
	if !memoryruntime.CommandReceiptStale(aged, time.Now()) {
		t.Fatal("untouched receipt beyond the margin must be stale")
	}
}
