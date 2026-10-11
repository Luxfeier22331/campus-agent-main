package memory

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

func TestExecuteOwnerTransitionDoesNotRequireProvider(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	adapter := New(Adapter{Service: &memoryapplication.Service{CommandStateStore: state, OwnerLifecycleStore: state, CallLeaseStore: state, OwnerSalt: "test-salt"}})
	result, err := adapter.ExecutePersonalMemoryCommand(context.Background(), memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "pause-without-provider",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-09-24T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant",
		UserID:            "user",
	})
	if err != nil {
		t.Fatalf("owner transition: %v", err)
	}
	if result.Status != "succeeded" {
		t.Fatalf("result = %#v", result)
	}
}

func TestExecuteOwnerEraseAdvancesFenceBeforeProviderAvailability(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	adapter := New(Adapter{Service: &memoryapplication.Service{CommandStateStore: state, OwnerLifecycleStore: state, CallLeaseStore: state, PersonalMemoryErr: context.Canceled, OwnerSalt: "test-salt"}})
	command := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "erase-without-provider",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-09-24T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant",
		UserID:            "user",
	}
	_, err := adapter.ExecutePersonalMemoryCommand(context.Background(), command)
	if err == nil {
		t.Fatal("owner erase without provider unexpectedly succeeded")
	}
	if err := state.BeginCall(context.Background(), memoryapplication.PersonalMemoryOwnerScopeHash("test-salt", "tenant", "user"), "stale", 1, "recall", time.Minute); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("stale recall error=%v, want fence conflict", err)
	}
}
