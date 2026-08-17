package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryactivity"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestPersonalMemoryProviderActivityLeavesTerminalReceiptToFinalizer(t *testing.T) {
	state := memoryruntime.NewInMemoryStateStore()
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	server.personalMemoryStateStore = state
	server.personalMemoryStateErr = nil
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-pause",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}

	result, err := server.ExecutePersonalMemoryCommand(context.Background(), command)
	if err != nil || result.Status != "succeeded" || executor.commandCount != 1 {
		t.Fatalf("provider result=%#v calls=%d err=%v", result, executor.commandCount, err)
	}
	ownerHash := personalMemoryOwnerScopeHash("owner-salt", command.TenantID, command.UserID)
	receipt, execute, err := state.BeginCommand(context.Background(), ownerHash, command, time.Minute)
	if err != nil || execute || receipt.Status != "processing" {
		t.Fatalf("receipt before finalizer=%#v execute=%t err=%v", receipt, execute, err)
	}

	finalized, err := server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result},
	)
	if err != nil || finalized.Status != "succeeded" || finalized.ResultFingerprint == "" {
		t.Fatalf("finalized result=%#v err=%v", finalized, err)
	}
	receipt, execute, err = state.BeginCommand(context.Background(), ownerHash, command, time.Minute)
	if err != nil || execute || receipt.Status != "succeeded" {
		t.Fatalf("receipt after finalizer=%#v execute=%t err=%v", receipt, execute, err)
	}

	replayed, err := server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: finalized},
	)
	if err != nil || replayed.ResultFingerprint != finalized.ResultFingerprint {
		t.Fatalf("idempotent finalizer result=%#v err=%v", replayed, err)
	}
	conflictingResult := finalized
	conflictingResult.Status = "failed"
	conflictingResult.ErrorCode = "personal_memory_command_failed"
	_, err = server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: conflictingResult},
	)
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) || applicationError.Type() != "memory_command_receipt_conflict" || !applicationError.NonRetryable() {
		t.Fatalf("terminal conflict error=%v, want non-retryable memory_command_receipt_conflict", err)
	}
}

func TestPersonalMemoryCommandActivityAllowsSameGenerationEraseAfterErased(t *testing.T) {
	state := memoryruntime.NewInMemoryStateStore()
	executor := &fakePersonalMemoryExecutor{}
	server := NewServer(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.personalMemoryExecutor = executor
	server.personalMemoryErr = nil
	server.personalMemoryStateStore = state
	server.personalMemoryStateErr = nil
	activities := memoryactivity.New(server)
	first := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "erase-first",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-08-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-erase-retry",
	}

	firstResult, err := activities.ExecutePersonalMemoryCommandActivity(context.Background(), first)
	if err != nil || firstResult.Status != "succeeded" {
		t.Fatalf("execute first erase result=%#v err=%v", firstResult, err)
	}
	if _, err := activities.FinalizePersonalMemoryCommandReceiptActivity(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{
			Command: first,
			Result:  firstResult,
		},
	); err != nil {
		t.Fatalf("finalize first erase: %v", err)
	}

	successor := first
	successor.CommandID = "erase-successor"
	successor.OwnerSequence = 2
	successorResult, err := activities.ExecutePersonalMemoryCommandActivity(context.Background(), successor)
	if err != nil || successorResult.Status != "succeeded" {
		t.Fatalf("execute successor erase result=%#v err=%v", successorResult, err)
	}
	if executor.commandCount != 2 {
		t.Fatalf("provider command count=%d, want 2", executor.commandCount)
	}
	if _, err := activities.FinalizePersonalMemoryCommandReceiptActivity(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{
			Command: successor,
			Result:  successorResult,
		},
	); err != nil {
		t.Fatalf("finalize successor erase: %v", err)
	}
}

func TestPersonalMemoryReceiptFinalizerRecoversMissingReceipt(t *testing.T) {
	state := memoryruntime.NewInMemoryStateStore()
	server := NewServer(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.personalMemoryStateStore = state
	server.personalMemoryStateErr = nil
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-missing-receipt",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-missing-receipt",
	}

	finalized, err := server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{
			Command: command,
			Result: temporalruntime.PersonalMemoryCommandActivityOutput{
				CommandID: command.CommandID,
				ErrorCode: "personal_memory_command_failed",
				Status:    "failed",
			},
		},
	)
	if err != nil || finalized.Status != "failed" {
		t.Fatalf("recover missing receipt result=%#v err=%v", finalized, err)
	}
	ownerHash := personalMemoryOwnerScopeHash("owner-salt", command.TenantID, command.UserID)
	receipt, execute, err := state.BeginCommand(context.Background(), ownerHash, command, time.Minute)
	if err != nil || execute || receipt.Status != "failed" {
		t.Fatalf("recovered terminal receipt=%#v execute=%t err=%v", receipt, execute, err)
	}
}

func TestPersonalMemoryCommandActivityRecordsHeartbeat(t *testing.T) {
	state := memoryruntime.NewInMemoryStateStore()
	server := NewServer(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{}
	server.personalMemoryErr = nil
	server.personalMemoryStateStore = state
	server.personalMemoryStateErr = nil
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-heartbeat",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-heartbeat",
	}

	env := (&testsuite.WorkflowTestSuite{}).NewTestActivityEnvironment()
	env.RegisterActivity(server.ExecutePersonalMemoryCommand)
	heartbeats := make([]string, 0, 1)
	env.SetOnActivityHeartbeatListener(func(_ *activity.Info, details converter.EncodedValues) {
		var detail string
		if err := details.Get(&detail); err != nil {
			t.Fatalf("decode heartbeat detail: %v", err)
		}
		heartbeats = append(heartbeats, detail)
	})
	if _, err := env.ExecuteActivity(server.ExecutePersonalMemoryCommand, command); err != nil {
		t.Fatalf("execute personal memory command activity: %v", err)
	}
	if len(heartbeats) == 0 || heartbeats[0] != "memory.command" {
		t.Fatalf("heartbeats = %#v, want bounded memory.command detail", heartbeats)
	}
}

func TestPersonalMemoryProviderFailureDoesNotPersistRawCause(t *testing.T) {
	state := memoryruntime.NewInMemoryStateStore()
	server := NewServer(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.personalMemoryExecutor = &fakePersonalMemoryExecutor{
		commandErr: errors.New(temporalFailureSentinel),
	}
	server.personalMemoryErr = nil
	server.personalMemoryStateStore = state
	server.personalMemoryStateErr = nil
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-provider-sanitized",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-provider-sanitized",
	}

	_, err := server.ExecutePersonalMemoryCommand(context.Background(), command)
	assertTemporalFailureSanitized(t, err, "hindsight_command_failed", false)
}
