package memoryapplication

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type profileServiceProvider struct {
	snapshot memoryruntime.ProfileModelSnapshot
	bank     bool
	model    bool
	created  int
}

func (p *profileServiceProvider) LookupProfileModel(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileModelSnapshot, bool, bool, error) {
	return p.snapshot, p.bank, p.model, nil
}
func (p *profileServiceProvider) CreateProfileModel(context.Context, memoryruntime.ProfileQuery) error {
	p.created++
	return nil
}

func TestProfileServiceOwnsEmptyAndLazyLifecycle(t *testing.T) {
	for _, tc := range []struct {
		name        string
		bank, model bool
		want        memoryruntime.ProfileRecord
		created     int
	}{
		{name: "empty bank", want: memoryruntime.ProfileRecord{}},
		{name: "lazy model", bank: true, want: memoryruntime.ProfileRecord{Generating: true}, created: 1},
		{name: "existing model", bank: true, model: true, want: memoryruntime.ProfileRecord{Content: "偏好", IsStale: true, LastRefreshedAt: "2026-10-10T00:00:00Z"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			provider := &profileServiceProvider{bank: tc.bank, model: tc.model, snapshot: memoryruntime.ProfileModelSnapshot{Content: "偏好", IsStale: true, LastRefreshedAt: "2026-10-10T00:00:00Z"}}
			state := memorypersistence.NewInMemoryStateStore()
			service := &ProfileService{Provider: provider, State: state, OwnerSalt: "salt", Timeout: time.Second}
			got, err := service.GetProfile(context.Background(), memoryruntime.ProfileQuery{TenantID: "tenant", OwnerUserID: "user", OwnerGeneration: 1})
			if err != nil || got != tc.want {
				t.Fatalf("got=%#v err=%v want=%#v", got, err, tc.want)
			}
			if provider.created != tc.created {
				t.Fatalf("created=%d want=%d", provider.created, tc.created)
			}
		})
	}
}
