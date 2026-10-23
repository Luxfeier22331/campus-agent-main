package memoryapplication

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

func TestProfileServiceReleasesManagementReadLease(t *testing.T) {
	state := memorypersistence.NewInMemoryStateStore()
	provider := &profileFenceProvider{}
	reader := &ProfileService{Provider: provider, State: state, OwnerSalt: "test-salt", Timeout: time.Minute}
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

type profileFenceProvider struct{}

func (profileFenceProvider) LookupProfileModel(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileModelSnapshot, bool, bool, error) {
	return memoryruntime.ProfileModelSnapshot{Content: "画像内容"}, true, true, nil
}
func (profileFenceProvider) CreateProfileModel(context.Context, memoryruntime.ProfileQuery) error {
	return nil
}
