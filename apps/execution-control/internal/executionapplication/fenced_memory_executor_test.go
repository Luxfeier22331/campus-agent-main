package executionapplication

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fencedMemoryTestExecutor struct{}

func (fencedMemoryTestExecutor) ExecuteCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error) {
	return memoryruntime.PersonalMemoryCommandResult{Status: "succeeded"}, nil
}

func (fencedMemoryTestExecutor) AppendConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendConversationTurnResult, error) {
	return memoryruntime.AppendConversationTurnResult{}, nil
}

func (fencedMemoryTestExecutor) Recall(context.Context, memoryruntime.RecallRequest) (memoryruntime.RecallResult, error) {
	return memoryruntime.RecallResult{}, nil
}

func (fencedMemoryTestExecutor) SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	return memoryruntime.AppendOperation{Status: "pending"}, nil
}

func (fencedMemoryTestExecutor) GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	return memoryruntime.AppendOperation{Status: "processing"}, nil
}

func (fencedMemoryTestExecutor) GetProfile(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error) {
	return memoryruntime.ProfileRecord{Content: "画像内容"}, nil
}

func TestFencedExecutorIncludesManagementReadsInGenerationDrain(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	executor := NewFencedExecutor(fencedMemoryTestExecutor{}, state, "test-salt", time.Minute)
	reader, ok := executor.(MemoryReader)
	if !ok {
		t.Fatal("fenced executor must expose the fenced management reader")
	}
	if _, err := reader.GetProfile(context.Background(), memoryruntime.ProfileQuery{TenantID: "tenant", OwnerUserID: "user", OwnerGeneration: 1}); err != nil {
		t.Fatalf("get profile: %v", err)
	}
	ownerHash := memoryruntime.OwnerScopeHash("test-salt", "tenant", "user")
	drained, err := state.GenerationDrained(context.Background(), ownerHash, 1)
	if err != nil {
		t.Fatalf("generation drain: %v", err)
	}
	if !drained {
		t.Fatal("management reads left an active lease")
	}
}

func TestFencedExecutorGuardsAsyncAppendWithTheOwnerFence(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	executor := NewFencedExecutor(fencedMemoryTestExecutor{}, state, "test-salt", time.Minute)
	async, ok := executor.(AsyncMemoryExecutor)
	if !ok {
		t.Fatal("fenced executor must expose the fenced async executor")
	}
	request := memoryruntime.AppendConversationTurnRequest{
		OwnerGeneration:      1,
		RequestID:            "request-1",
		TenantID:             "tenant",
		ThreadID:             "thread",
		UserID:               "user",
		UserMessage:          "hello",
		UserMessageCreatedAt: "2026-07-16T00:00:00Z",
		UserMessageID:        "message-1",
	}
	if _, err := async.SubmitConversationTurn(context.Background(), request); err != nil {
		t.Fatalf("active async append: %v", err)
	}
	_ = state.EndCall(context.Background(), memoryruntime.OwnerScopeHash("test-salt", "tenant", "user"), "request-1:append")

	pausedState := memorypersistence.NewInMemoryStateStore()
	pausedExecutor := NewFencedExecutor(fencedMemoryTestExecutor{}, pausedState, "test-salt", time.Minute)
	transition := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "pause-1",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant",
		UserID:            "user",
	}
	ownerHash := memoryruntime.OwnerScopeHash("test-salt", "tenant", "user")
	if _, execute, err := pausedState.BeginCommand(context.Background(), ownerHash, transition, time.Minute); err != nil || !execute {
		t.Fatalf("pause transition execute=%t err=%v", execute, err)
	}
	pausedAsync, ok := pausedExecutor.(AsyncMemoryExecutor)
	if !ok {
		t.Fatal("paused fenced executor must expose the fenced async executor")
	}
	if _, err := pausedAsync.SubmitConversationTurn(context.Background(), request); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("paused async append error=%v, want fence conflict", err)
	}
}
