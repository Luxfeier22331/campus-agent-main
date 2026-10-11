package adaptertest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestPersonalMemoryProviderActivityLeavesTerminalReceiptToFinalizer(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	executor := &fakePersonalMemoryExecutor{}
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.CommandExecutor = executor
	server.Recaller = executor
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
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
	if err != nil || result.Status != "succeeded" || executor.commandCount != 0 {
		t.Fatalf("provider result=%#v calls=%d err=%v", result, executor.commandCount, err)
	}
	ownerHash := memoryapplication.PersonalMemoryOwnerScopeHash("owner-salt", command.TenantID, command.UserID)
	receipt, execute, err := state.BeginCommand(context.Background(), ownerHash, command, time.Minute)
	if err != nil || execute || receipt.Status != "processing" {
		t.Fatalf("receipt before finalizer=%#v execute=%t err=%v", receipt, execute, err)
	}

	finalized, err := server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: workflowcontract.MemoryCommandToWorkflow(command), Result: result},
	)
	if err != nil || finalized.Status != "succeeded" {
		t.Fatalf("finalized result=%#v err=%v", finalized, err)
	}
	receipt, execute, err = state.BeginCommand(context.Background(), ownerHash, command, time.Minute)
	if err != nil || execute || receipt.Status != "succeeded" {
		t.Fatalf("receipt after finalizer=%#v execute=%t err=%v", receipt, execute, err)
	}

	replayed, err := server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: workflowcontract.MemoryCommandToWorkflow(command), Result: finalized},
	)
	if err != nil || replayed.Status != finalized.Status || replayed.ErrorCode != finalized.ErrorCode {
		t.Fatalf("idempotent finalizer result=%#v err=%v", replayed, err)
	}
	conflictingResult := finalized
	conflictingResult.Status = "failed"
	conflictingResult.ErrorCode = "personal_memory_command_failed"
	_, err = server.FinalizePersonalMemoryCommandReceipt(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{Command: workflowcontract.MemoryCommandToWorkflow(command), Result: conflictingResult},
	)
	var applicationError *temporal.ApplicationError
	if !errors.As(err, &applicationError) || applicationError.Type() != "memory_command_receipt_conflict" || !applicationError.NonRetryable() {
		t.Fatalf("terminal conflict error=%v, want non-retryable memory_command_receipt_conflict", err)
	}
}

func TestPersonalMemoryCommandActivityAllowsSameGenerationEraseAfterErased(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	executor := &fakePersonalMemoryExecutor{}
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	memoryAdapter := NewMemoryAdapter(server)
	server.CommandExecutor = executor
	server.Recaller = executor
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
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

	firstResult, err := memoryAdapter.ExecutePersonalMemoryCommandActivity(context.Background(), workflowcontract.MemoryCommandToWorkflow(first))
	if err != nil || firstResult.Status != "succeeded" {
		t.Fatalf("execute first erase result=%#v err=%v", firstResult, err)
	}
	if _, err := memoryAdapter.FinalizePersonalMemoryCommandReceiptActivity(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{
			Command: workflowcontract.MemoryCommandToWorkflow(first),
			Result:  firstResult,
		},
	); err != nil {
		t.Fatalf("finalize first erase: %v", err)
	}

	successor := first
	successor.CommandID = "erase-successor"
	successor.OwnerSequence = 2
	successorResult, err := memoryAdapter.ExecutePersonalMemoryCommandActivity(context.Background(), workflowcontract.MemoryCommandToWorkflow(successor))
	if err != nil || successorResult.Status != "succeeded" {
		t.Fatalf("execute successor erase result=%#v err=%v", successorResult, err)
	}
	if executor.commandCount != 2 {
		t.Fatalf("provider command count=%d, want 2", executor.commandCount)
	}
	if _, err := memoryAdapter.FinalizePersonalMemoryCommandReceiptActivity(
		context.Background(),
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput{
			Command: workflowcontract.MemoryCommandToWorkflow(successor),
			Result:  successorResult,
		},
	); err != nil {
		t.Fatalf("finalize successor erase: %v", err)
	}
}

func TestPersonalMemoryReceiptFinalizerToleratesMissingReceipt(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
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
			Command: workflowcontract.MemoryCommandToWorkflow(command),
			Result: temporalruntime.PersonalMemoryCommandActivityOutput{
				CommandID: command.CommandID,
				ErrorCode: "personal_memory_command_failed",
				Status:    "failed",
			},
		},
	)
	if err != nil || finalized.Status != "failed" {
		t.Fatalf("missing receipt flow-through result=%#v err=%v", finalized, err)
	}
	// The finalizer must not create receipts. A command without a receipt is
	// re-admitted from scratch, and re-admission either resumes it or is a
	// no-op, so creating a blocked receipt here would dead-end the owner.
	ownerHash := memoryapplication.PersonalMemoryOwnerScopeHash("owner-salt", command.TenantID, command.UserID)
	if _, err := state.GetCommand(context.Background(), ownerHash, command.CommandID); !errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
		t.Fatalf("receipt after finalization error=%v, want ErrMemoryCommandNotFound", err)
	}
}

func TestPersonalMemoryCommandActivityRecordsHeartbeat(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.SetPersonalMemoryExecutor(&fakePersonalMemoryExecutor{})
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
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

func TestPersonalMemoryEraseDrainTimeoutFailsInsteadOfRetryingForever(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.SetPersonalMemoryExecutor(&fakePersonalMemoryExecutor{})
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
	ownerHash := memoryapplication.PersonalMemoryOwnerScopeHash("owner-salt", "tenant-main", "user-erase-drain-timeout")
	stale := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-stale-edit",
		CommandKind:       "memory_add",
		Item:              &memoryruntime.PersonalMemoryCommandItem{Text: "stale"},
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SubjectID:         "memory-stale",
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "item:memory-stale",
		TenantID:          "tenant-main",
		UserID:            "user-erase-drain-timeout",
	}
	if _, execute, err := state.BeginCommand(context.Background(), ownerHash, stale, time.Minute); err != nil || !execute {
		t.Fatalf("begin stale edit execute=%t err=%v", execute, err)
	}
	erase := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase-drain-timeout",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:02Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-erase-drain-timeout",
	}
	if _, err := server.ExecutePersonalMemoryCommand(context.Background(), erase); err == nil {
		t.Fatal("fresh erase receipt unexpectedly avoided the drain wait")
	}
	// Age the erase receipt beyond the drain bound without ending the stale
	// generation lease, then rerun the same command as a retry would.
	state.ShiftReceiptClockForTest(erase.CommandID, -25*time.Hour)
	result, err := server.ExecutePersonalMemoryCommand(context.Background(), erase)
	if err != nil || result.Status != "failed" || result.ErrorCode != "memory_generation_drain_timeout" {
		t.Fatalf("drain-timeout result=%#v err=%v, want failed memory_generation_drain_timeout", result, err)
	}
}

func TestPersonalMemoryEraseRevivesLostAppendWorkflowsWhileWaitingForDrain(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.SetPersonalMemoryExecutor(&fakePersonalMemoryExecutor{})
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
	reviver := &fakeAppendWorkflowReviver{running: map[string]bool{"lost-run": false, "alive-run": true, "gone-run": false}}
	server.AppendWorkflowReviver = reviver
	ownerHash := memoryapplication.PersonalMemoryOwnerScopeHash("owner-salt", "tenant-main", "user-erase-revive")
	for _, requestID := range []string{"lost-run", "alive-run", "gone-run"} {
		if err := state.BeginCall(context.Background(), ownerHash, requestID+":append", 1, "append", 0); err != nil {
			t.Fatalf("begin durable append lease %s: %v", requestID, err)
		}
	}
	erase := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase-revive",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     4,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:02Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-erase-revive",
	}
	if _, err := server.ExecutePersonalMemoryCommand(context.Background(), erase); err == nil {
		t.Fatal("erase unexpectedly finished while append leases still hold the generation")
	}
	if len(reviver.restarted) != 2 || reviver.restarted[0] != "gone-run" || reviver.restarted[1] != "lost-run" {
		t.Fatalf("restarted workflows = %#v, want [gone-run lost-run]", reviver.restarted)
	}
}

type fakeAppendWorkflowReviver struct {
	running     map[string]bool
	restarted   []string
	describeErr error
}

func (reviver *fakeAppendWorkflowReviver) RestartMemoryAppendWorkflow(_ context.Context, requestID string) error {
	reviver.restarted = append(reviver.restarted, requestID)
	return nil
}

func (reviver *fakeAppendWorkflowReviver) RunningMemoryAppendWorkflows(_ context.Context, requestIDs []string) (map[string]bool, error) {
	if reviver.describeErr != nil {
		return nil, reviver.describeErr
	}
	running := make(map[string]bool, len(requestIDs))
	for _, requestID := range requestIDs {
		running[requestID] = reviver.running[requestID]
	}
	return running, nil
}

func TestPersonalMemoryProviderFailureDoesNotPersistRawCause(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	server.CommandExecutor = &fakePersonalMemoryExecutor{
		commandErr: errors.New(temporalFailureSentinel),
	}
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-provider-sanitized",
		CommandKind:       "memory_add",
		Item:              &memoryruntime.PersonalMemoryCommandItem{Text: "新的偏好"},
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SubjectID:         "memory-1",
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "memory:memory-1",
		TenantID:          "tenant-main",
		UserID:            "user-provider-sanitized",
	}

	_, err := server.ExecutePersonalMemoryCommand(context.Background(), command)
	assertTemporalFailureSanitized(t, err, "hindsight_command_failed", false)
}

func TestPersonalMemoryEraseKeepsStaleGenerationReceiptBlockingDrain(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	server := newAdapterForTest(config.Config{PersonalMemoryOwnerSalt: "owner-salt"})
	executor := &fakePersonalMemoryExecutor{}
	server.SetPersonalMemoryExecutor(executor)
	server.PersonalMemoryErr = nil
	server.CommandStateStore = state
	server.CallLeaseStore = state
	server.OwnerLifecycleStore = state
	server.PersonalMemoryStateErr = nil
	ownerHash := memoryapplication.PersonalMemoryOwnerScopeHash("owner-salt", "tenant-main", "user-erase-abandon")
	orphan := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-orphan-edit",
		CommandKind:       "memory_add",
		Item:              &memoryruntime.PersonalMemoryCommandItem{Text: "orphan"},
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SubjectID:         "memory-orphan",
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "item:memory-orphan",
		TenantID:          "tenant-main",
		UserID:            "user-erase-abandon",
	}
	if _, execute, err := state.BeginCommand(context.Background(), ownerHash, orphan, time.Minute); err != nil || !execute {
		t.Fatalf("begin orphan execute=%t err=%v", execute, err)
	}
	// The orphan's workflow is gone: nobody touches the receipt anymore.
	state.ShiftReceiptClockForTest(orphan.CommandID, -memoryruntime.CommandReceiptStaleAfter-time.Minute)
	erase := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-erase-abandon",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:02Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-erase-abandon",
	}
	_, err := server.ExecutePersonalMemoryCommand(context.Background(), erase)
	assertTemporalFailureSanitized(t, err, "memory_generation_not_drained", false)
	orphanReceipt, err := state.GetCommand(context.Background(), ownerHash, orphan.CommandID)
	if err != nil || orphanReceipt.Status != "processing" {
		t.Fatalf("orphan receipt=%#v err=%v, want unresolved processing receipt", orphanReceipt, err)
	}
	drained, err := state.GenerationDrained(context.Background(), ownerHash, 1)
	if err != nil || drained {
		t.Fatalf("generation drained=%t err=%v, want stale receipt to block erase", drained, err)
	}
	if executor.commandCount != 0 {
		t.Fatalf("provider command calls=%d, want erase not to reach provider", executor.commandCount)
	}
}
